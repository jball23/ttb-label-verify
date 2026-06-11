import path from 'node:path';
import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  Path2D,
  type Canvas,
} from '@napi-rs/canvas';

// Webpack's static analyzer rewrites createRequire(...).resolve(...) calls
// into webpack module IDs at build time (e.g. "(rsc)/./node_modules/..."),
// which then fail at runtime when pdfjs hands them to fs.readFile. Compute
// pdfjs-dist's location from process.cwd() so webpack stays out of it.
// pdfjs-dist is listed in next.config's serverExternalPackages, so its files
// live in the standard node_modules/ tree at runtime.
const PDFJS_ROOT = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
const PDFJS_WORKER_SRC = path.join(
  PDFJS_ROOT,
  'legacy',
  'build',
  'pdf.worker.mjs',
);
// Trailing slash matters — pdfjs concatenates `baseUrl + filename`.
const STANDARD_FONT_DATA_URL = path.join(PDFJS_ROOT, 'standard_fonts') + '/';

const TARGET_DPI = 200;
const PDF_DEFAULT_DPI = 72;
const RENDER_SCALE = TARGET_DPI / PDF_DEFAULT_DPI;
// Cap on rendered pages per PDF. Real TTB COLA Online exports are typically
// 2-3 pages (form + labels + footer); we accept a little headroom so a
// chunkier export still produces something usable, without ever fanning out
// to dozens of LLM-input pages.
const MAX_PAGES_TO_RENDER = 4;

// Substrings that identify a "form" page. These match the printed TTB Form
// 5100.31 chrome (item headings + part dividers) so we can tell which page
// holds the application fields when a PDF is multi-page.
const FORM_PAGE_MARKERS = [
  'PART I - APPLICATION',
  'BRAND NAME',
  'TYPE OF PRODUCT',
  'PLANT REGISTRY',
  'SERIAL NUMBER',
  'TYPE OF APPLICATION',
  'NAME AND ADDRESS OF APPLICANT',
  'FANCIFUL NAME',
];

// Substrings that identify a "label" page — either the printed instructions
// telling the applicant where to affix the artwork, or the COLA Online
// export's image-block headings ("Image Type:", "Brand (front)").
const LABEL_PAGE_MARKERS = [
  'AFFIX COMPLETE SET OF LABELS',
  'Image Type:',
  'Brand (front)',
];

let polyfillsApplied = false;
function ensurePolyfills(): void {
  if (polyfillsApplied) return;
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.Image) g.Image = Image;
  if (!g.ImageData) g.ImageData = ImageData;
  if (!g.Path2D) g.Path2D = Path2D;
  polyfillsApplied = true;
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(
    canvasAndContext: { canvas: Canvas },
    width: number,
    height: number,
  ): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: Canvas | null; context: unknown | null }): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export class PdfRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfRenderError';
  }
}

export interface RenderedPage {
  /** 1-indexed page number in the original PDF. */
  pageNumber: number;
  /** Why this page was selected — form fields, label artwork, or both. */
  kind: 'form' | 'label' | 'form+label';
  png: Buffer;
}

interface PageClassification {
  pageNumber: number;
  formMarkerHits: number;
  hasLabelMarker: boolean;
  nonEmptyTextItems: number;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
}
interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str: string }> }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  cleanup(): void;
}

async function loadDocument(pdfBuffer: Uint8Array | Buffer): Promise<PdfDocument> {
  ensurePolyfills();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }
  try {
    return (await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      // `canvasFactory` is supported on the pdfjs runtime but not in its public
      // type — cast to bypass the gap rather than ship a misleading type for it.
      canvasFactory: new NodeCanvasFactory(),
    } as Parameters<typeof pdfjs.getDocument>[0]).promise) as unknown as PdfDocument;
  } catch (e) {
    throw new PdfRenderError(`Could not parse PDF: ${(e as Error).message}`, {
      cause: e,
    });
  }
}

async function classifyPage(page: PdfPage, pageNumber: number): Promise<PageClassification> {
  const text = await page.getTextContent();
  const items = text.items.map((t) => t.str);
  const joined = items.join(' ');
  return {
    pageNumber,
    formMarkerHits: FORM_PAGE_MARKERS.filter((m) => joined.includes(m)).length,
    hasLabelMarker: LABEL_PAGE_MARKERS.some((m) => joined.includes(m)),
    nonEmptyTextItems: items.filter((s) => s.trim().length > 0).length,
  };
}

/**
 * Pick which pages to render. Strategy:
 *   1. Pick the single page with the most form markers — that's where the
 *      Item 1–18 fields live.
 *   2. Pick every page that has a label marker (AFFIX / Image Type: / Brand
 *      (front)) — those hold the affixed artwork.
 *   3. If no label marker appears anywhere, assume the form page also holds
 *      the label (our bundled fixtures are single-page like this).
 *   4. Cap the result at MAX_PAGES_TO_RENDER. Skip footer-only pages, which
 *      have neither markers nor enough text content to anchor either source.
 *
 * Returns the chosen pages with their `kind`, in PDF page order.
 */
function pickPagesToRender(classes: PageClassification[]): Array<{
  pageNumber: number;
  kind: 'form' | 'label' | 'form+label';
}> {
  if (classes.length === 0) return [];

  // Form page = highest formMarkerHits. Ties broken by earlier page first.
  const formPage = classes.reduce((best, c) =>
    c.formMarkerHits > best.formMarkerHits ? c : best,
  );
  const labelPageNumbers = classes
    .filter((c) => c.hasLabelMarker)
    .map((c) => c.pageNumber);

  const selected = new Map<number, 'form' | 'label' | 'form+label'>();
  selected.set(formPage.pageNumber, 'form');
  if (labelPageNumbers.length === 0) {
    // Single-page fixture path — same page is the label too.
    selected.set(formPage.pageNumber, 'form+label');
  } else {
    for (const n of labelPageNumbers) {
      selected.set(n, selected.has(n) ? 'form+label' : 'label');
    }
  }

  return Array.from(selected.entries())
    .map(([pageNumber, kind]) => ({ pageNumber, kind }))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .slice(0, MAX_PAGES_TO_RENDER);
}

async function renderPage(page: PdfPage): Promise<Buffer> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  try {
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
  } catch (e) {
    throw new PdfRenderError(`Page render failed: ${(e as Error).message}`, {
      cause: e,
    });
  } finally {
    page.cleanup();
  }
  return canvas.toBuffer('image/png');
}

/**
 * Render the pages of `pdfBuffer` that the verifier actually needs — the
 * form-fields page plus any pages that carry the affixed label artwork.
 * For a bundled single-page fixture this is one PNG; for a real TTB COLA
 * Online export (form on page 1, labels on page 2, footer on page 3) it's
 * two PNGs. See `pickPagesToRender` for the selection logic.
 */
export async function renderApplicationPages(
  pdfBuffer: Uint8Array | Buffer,
): Promise<RenderedPage[]> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new PdfRenderError('Empty PDF buffer.');
  }
  const doc = await loadDocument(pdfBuffer);
  if (doc.numPages < 1) {
    throw new PdfRenderError('PDF has no pages.');
  }

  try {
    const classes: PageClassification[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        classes.push(await classifyPage(page, i));
      } finally {
        page.cleanup();
      }
    }

    const picked = pickPagesToRender(classes);
    const rendered: RenderedPage[] = [];
    for (const { pageNumber, kind } of picked) {
      const page = await doc.getPage(pageNumber);
      rendered.push({ pageNumber, kind, png: await renderPage(page) });
    }
    return rendered;
  } finally {
    await doc.cleanup();
  }
}

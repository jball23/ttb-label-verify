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

// Unconditional, module-load-time. The previous guarded form (only set the
// polyfills if not already set) led to subtle interactions with pdfjs's
// internal worker which expects the @napi-rs/canvas implementations
// specifically; an "already-set" foreign DOMMatrix caused render() to fail
// with "Value is none of these types String, Path" deep inside paintChar.
(() => {
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix = DOMMatrix;
  g.Image = Image;
  g.ImageData = ImageData;
  g.Path2D = Path2D;
})();

// Inline object literal rather than a class — class instances of this shape
// trigger pdfjs's "Value is none of these types String, Path" failure from
// canvas.paintChar on render() after a prior getTextContent/getOperatorList
// call. The literal form (same shape) does not. The root cause appears to be
// the way pdfjs uses the factory across worker calls; the literal sidesteps it.
const nodeCanvasFactory = {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(
    canvasAndContext: { canvas: Canvas },
    width: number,
    height: number,
  ): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },
  destroy(): void {},
};

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
  hasImageContent: boolean;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
}
interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str: string }> }>;
  getOperatorList(): Promise<{ fnArray: number[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  cleanup(): void;
}

// Operator codes that draw a raster image XObject onto the page. Used to
// detect pages that contain affixed-label artwork without any of our text
// markers (real TTB COLA exports put the "back" label on its own page,
// after the page whose text says "Image Type: Back" — the back artwork
// itself lives on the next page with almost no text).
const PDFJS_IMAGE_OPS = new Set<number>();
let pdfjsImageOpsInit = false;
async function loadImageOps(): Promise<void> {
  if (pdfjsImageOpsInit) return;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS as Record<string, number>;
  for (const key of [
    'paintImageXObject',
    'paintInlineImageXObject',
    'paintImageMaskXObject',
    'paintImageXObjectRepeat',
    'paintImageMaskXObjectRepeat',
    'paintImageMaskXObjectGroup',
  ]) {
    const code = OPS[key];
    if (typeof code === 'number') PDFJS_IMAGE_OPS.add(code);
  }
  pdfjsImageOpsInit = true;
}

// Threshold for "this page is text-light enough to be a continuation
// label rather than form text." Form pages have hundreds of text items;
// real label pages (front or back artwork on their own page) usually
// have <20 text items — mostly an "Image Type:" header or just the
// footer. Bare-footer pages (~5 items) can therefore look identical to
// a back-label-only page; the `hasImageContent` check disambiguates.
const LIGHT_TEXT_THRESHOLD = 30;

async function loadDocument(pdfBuffer: Uint8Array | Buffer): Promise<PdfDocument> {
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
      canvasFactory: nodeCanvasFactory,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise) as unknown as PdfDocument;
  } catch (e) {
    throw new PdfRenderError(`Could not parse PDF: ${(e as Error).message}`, {
      cause: e,
    });
  }
}

async function classifyPage(page: PdfPage, pageNumber: number): Promise<PageClassification> {
  // Sequential — pdfjs's getTextContent and getOperatorList can race on
  // shared page state when run via Promise.all, occasionally leaving the
  // page in a state where a subsequent render() throws "Value is none of
  // these types String, Path" from canvas.paintChar (glyph cache miss).
  const text = await page.getTextContent();
  const opList = await page.getOperatorList();
  const items = text.items.map((t) => t.str);
  const joined = items.join(' ');
  const hasImageContent = opList.fnArray.some((fn) => PDFJS_IMAGE_OPS.has(fn));
  return {
    pageNumber,
    formMarkerHits: FORM_PAGE_MARKERS.filter((m) => joined.includes(m)).length,
    hasLabelMarker: LABEL_PAGE_MARKERS.some((m) => joined.includes(m)),
    nonEmptyTextItems: items.filter((s) => s.trim().length > 0).length,
    hasImageContent,
  };
}

/**
 * Pick which pages to render. Strategy:
 *   1. Pick the single page with the most form markers — that's where the
 *      Item 1–18 fields live.
 *   2. Pick every page that has a label marker (AFFIX / Image Type: / Brand
 *      (front)) — those hold the affixed artwork.
 *   3. Also pick every non-form page that has an embedded image XObject and
 *      light text content. Real TTB COLA exports put the BACK label on its
 *      own page, after the page whose text mentions "Image Type: Back" —
 *      that back-label page has almost no text and would be skipped by
 *      step 2, but it's the page that carries the Government Warning,
 *      net-contents, and "Produced & Bottled by" attribution. Without this
 *      heuristic the model only sees the front label and picks decorative
 *      text as the producer.
 *   4. If no label-marker page exists, assume the form page also holds the
 *      label (our bundled fixtures are single-page like this).
 *   5. Cap at MAX_PAGES_TO_RENDER.
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
    .filter((c) => {
      if (c.pageNumber === formPage.pageNumber) return false;
      if (c.hasLabelMarker) return true;
      // Continuation-label heuristic: low text + has an image XObject.
      return (
        c.hasImageContent && c.nonEmptyTextItems < LIGHT_TEXT_THRESHOLD
      );
    })
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
  }
  // Cleanup is owned by the outer caller via doc.cleanup(); calling it here
  // discards the font/glyph cache prematurely and breaks any subsequent
  // operations against the same page proxy.
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
  await loadImageOps();

  const doc = await loadDocument(pdfBuffer);
  if (doc.numPages < 1) {
    await doc.cleanup();
    throw new PdfRenderError('PDF has no pages.');
  }

  try {
    // Phase 1: classify every page on the doc — but DO NOT cleanup() any
    // pages here. cleanup() discards the page's font/glyph cache, and
    // calling render() afterward fails with "Value is none of these types
    // String, Path" because canvas.paintChar can't find the glyph. The
    // pages we don't end up rendering will be cleaned when doc.cleanup()
    // runs in the outer finally.
    const classes: PageClassification[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      classes.push(await classifyPage(page, i));
    }

    const picked = pickPagesToRender(classes);
    const rendered: RenderedPage[] = [];
    for (const { pageNumber, kind } of picked) {
      const page = await doc.getPage(pageNumber);
      try {
        rendered.push({ pageNumber, kind, png: await renderPage(page) });
      } catch (e) {
        // Real TTB COLA exports occasionally carry exotic fonts that pdfjs
        // can't render. Don't fail the whole verify on a single page — drop
        // it and continue. The form page is required; anything else is
        // best-effort.
        if (kind === 'form' || kind === 'form+label') throw e;
        console.warn(
          `[renderApplicationPages] skipping page ${pageNumber} (${kind}): ${(e as Error).message}`,
        );
      }
    }
    return rendered;
  } finally {
    await doc.cleanup();
  }
}

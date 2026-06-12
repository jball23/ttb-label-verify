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

// Markers that announce the FRONT label artwork. Real TTB COLA Online
// exports place these on the form page; the actual front-label artwork is
// on the *next* page in PDF order. KD8 / U11 — the classifier tags the
// following page as 'label-front' rather than tagging the marker-bearing
// page itself.
const FRONT_LABEL_MARKERS = [
  'Brand (front) or keg collar',
  'Brand (front)',
  'or keg collar',
];

// Markers that announce the BACK label artwork. Same next-page convention.
const BACK_LABEL_MARKERS = ['Image Type: Back'];

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

/**
 * What kind of source content lives on a rendered page. The Tesseract-bbox
 * pipeline (U11 / KD8) emits the front/back-distinguished variants so the
 * detail-view source viewer can tab between them. The legacy `'label'` /
 * `'form+label'` tags remain for synthetic fixtures and as a fallback when
 * the classifier can't tell which side a label page belongs to.
 */
export type RenderedPageKind =
  | 'form'
  | 'label'
  | 'label-front'
  | 'label-back'
  | 'form+label'
  | 'form+label-front'
  | 'form+label-back';

export interface RenderedPage {
  /** 1-indexed page number in the original PDF. */
  pageNumber: number;
  /** Why this page was selected — form fields, label artwork, or both. */
  kind: RenderedPageKind;
  png: Buffer;
}

interface PageClassification {
  pageNumber: number;
  formMarkerHits: number;
  hasLabelMarker: boolean;
  /** How many Front-label markers appear on this page's text. >0 => the NEXT page is the front artwork. */
  frontMarkerHits: number;
  /** Same for Back markers. */
  backMarkerHits: number;
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
    frontMarkerHits: FRONT_LABEL_MARKERS.filter((m) => joined.includes(m)).length,
    backMarkerHits: BACK_LABEL_MARKERS.filter((m) => joined.includes(m)).length,
    nonEmptyTextItems: items.filter((s) => s.trim().length > 0).length,
    hasImageContent,
  };
}

/**
 * Pick which pages to render and tag them with their content kind. Strategy:
 *   1. Pick the single page with the most form markers — that's where the
 *      Item 1–18 fields live (tagged 'form').
 *   2. **U11 / KD8 — front/back resolution.** For each page that carries a
 *      Front-marker ("Brand (front) or keg collar", "Image Type: Brand"),
 *      tag the *next* page as 'label-front'. For each page that carries a
 *      Back-marker ("Image Type: Back"), tag the *next* page as 'label-back'.
 *      The marker-bearing page itself stays form chrome and is not surfaced
 *      to the viewer. If a marker lives on the last page (no next page),
 *      the marker page itself is tagged as the artwork — better to show
 *      something than nothing.
 *   3. Legacy fallback for pages that have a label marker but no explicit
 *      Front/Back classification (older synthetic fixtures, weird exports):
 *      tag as 'label'. The new Tesseract pipeline can still OCR these;
 *      the source-viewer just doesn't get an explicit Front/Back tab.
 *   4. Continuation-label heuristic: a non-form page with an embedded image
 *      XObject and light text content is probably back-label artwork even
 *      without a marker, so tag as 'label-back' by default (Government
 *      Warning + producer info traditionally live on the back).
 *   5. If no label tags get assigned, the form page also holds the label —
 *      single-page synthetic fixture path, tag as 'form+label-front'.
 *   6. Cap at MAX_PAGES_TO_RENDER, preserving PDF page order.
 *
 * Returns the chosen pages with their `kind`, in PDF page order.
 */
function pickPagesToRender(classes: PageClassification[]): Array<{
  pageNumber: number;
  kind: RenderedPageKind;
}> {
  if (classes.length === 0) return [];

  // Form page = highest formMarkerHits. Ties broken by earlier page first.
  const formPage = classes.reduce((best, c) =>
    c.formMarkerHits > best.formMarkerHits ? c : best,
  );
  const lastPageNumber = classes[classes.length - 1]!.pageNumber;

  // Map pageNumber → classification for O(1) lookup.
  const byNumber = new Map<number, PageClassification>();
  for (const c of classes) byNumber.set(c.pageNumber, c);

  const selected = new Map<number, RenderedPageKind>();
  selected.set(formPage.pageNumber, 'form');

  // Step 2 — Front/Back marker resolution. Walk pages in PDF order; for each
  // marker hit, tag the next page as the corresponding artwork kind.
  for (const c of classes) {
    if (c.frontMarkerHits > 0) {
      const target = c.pageNumber + 1 <= lastPageNumber ? c.pageNumber + 1 : c.pageNumber;
      assignArtwork(selected, target, formPage.pageNumber, 'label-front');
    }
    if (c.backMarkerHits > 0) {
      // If front and back markers share a page, the front already claimed
      // c.pageNumber + 1 — give back the page after that.
      let target = c.pageNumber + 1;
      if (selected.get(target) === 'label-front' || selected.get(target) === 'form+label-front') {
        target = target + 1;
      }
      if (target > lastPageNumber) target = c.pageNumber;
      assignArtwork(selected, target, formPage.pageNumber, 'label-back');
    }
  }

  // Step 4 — Continuation-label heuristic for image-bearing low-text pages
  // that haven't been claimed yet. Tag as 'label-back' by default (the
  // back label is where the Government Warning + producer attribution
  // traditionally live).
  for (const c of classes) {
    if (selected.has(c.pageNumber)) continue;
    if (c.pageNumber === formPage.pageNumber) continue;
    if (c.hasImageContent && c.nonEmptyTextItems < LIGHT_TEXT_THRESHOLD) {
      selected.set(c.pageNumber, 'label-back');
    }
  }

  // Step 3 — Pages with a generic label marker (AFFIX / Image Type:) that
  // we couldn't classify as front or back specifically. Catch-all fallback.
  for (const c of classes) {
    if (selected.has(c.pageNumber)) continue;
    if (c.pageNumber === formPage.pageNumber) continue;
    if (c.hasLabelMarker) {
      selected.set(c.pageNumber, 'label');
    }
  }

  // Step 5 — Single-page synthetic fixture path: nothing was tagged as
  // artwork. The form page also holds the label.
  const hasAnyArtwork = Array.from(selected.values()).some(
    (k) => k !== 'form',
  );
  if (!hasAnyArtwork) {
    selected.set(formPage.pageNumber, 'form+label-front');
  }

  return Array.from(selected.entries())
    .map(([pageNumber, kind]) => ({ pageNumber, kind }))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .slice(0, MAX_PAGES_TO_RENDER);
}

/**
 * Assigns a `label-front` / `label-back` kind to the target page, merging
 * cleanly with any prior tag. If the target is the form page, upgrades the
 * form tag to `'form+label-front'` / `'form+label-back'`.
 */
function assignArtwork(
  selected: Map<number, RenderedPageKind>,
  target: number,
  formPageNumber: number,
  artwork: 'label-front' | 'label-back',
): void {
  const existing = selected.get(target);
  if (target === formPageNumber) {
    // Front/back marker on or pointing back to the form page — single-page
    // synthetic fixture or otherwise weird input. Upgrade to form+label-*.
    selected.set(target, artwork === 'label-front' ? 'form+label-front' : 'form+label-back');
    return;
  }
  if (existing === 'label-front' && artwork === 'label-back') {
    // Same page got tagged as both — unusual. Keep as label-front since
    // it landed first; back goes to the next slot.
    return;
  }
  if (existing === 'label-back' && artwork === 'label-front') {
    return;
  }
  selected.set(target, artwork);
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

import path from 'node:path';
import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  loadImage,
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

// Substrings that identify a page that points at label artwork. The verifier
// prefers pages with the label image itself; these markers are a fallback for
// unusual PDFs with vector/text labels or missing image metadata.
const LABEL_PAGE_MARKERS = [
  'AFFIX COMPLETE SET OF LABELS',
  'Image Type:',
  'Brand (front)',
];

// Markers that announce the FRONT label artwork. Real TTB COLA Online
// exports place these on the form page; the actual front-label artwork is
// often on the next page in PDF order. The classifier tags the artwork page
// rather than the marker-bearing form page.
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
 * pipeline emits front/back-distinguished variants only when the PDF provides
 * those markers. The generic `'label'` / `'form+label'` tags remain for
 * synthetic fixtures and for label artwork whose side cannot be determined.
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
  /** Full rendered PDF page, used by the reviewer-facing source viewer. */
  png: Buffer;
  /**
   * Extraction-only image. For label pages this masks everything outside the
   * embedded label artwork regions, so OCR cannot read COLA form/chrome text.
   */
  ocrPng?: Buffer;
  /** Natural PDF page width in points (72 DPI). Present for real pdfjs renders. */
  pageWidth?: number;
  /** Natural PDF page height in points (72 DPI). Present for real pdfjs renders. */
  pageHeight?: number;
  /** Text-layer items from pdfjs, in PDF point coordinates. */
  textItems?: PdfTextItem[];
  /** Label artwork rectangles in rendered-page pixel coordinates. */
  labelImageRegions?: PixelRect[];
}

export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfTextItem {
  text: string;
  /** PDF-space x coordinate in points, origin bottom-left. */
  x: number;
  /** PDF-space y coordinate in points, origin bottom-left. */
  y: number;
  width: number;
  height: number;
}

interface PageClassification {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  textItems: PdfTextItem[];
  formMarkerHits: number;
  hasLabelMarker: boolean;
  /** How many Front-label markers appear on this page's text. >0 => the NEXT page is the front artwork. */
  frontMarkerHits: number;
  /** Same for Back markers. */
  backMarkerHits: number;
  nonEmptyTextItems: number;
  hasImageContent: boolean;
  hasLabelImageContent: boolean;
  largestImageArea: number;
  labelImageRegions: PixelRect[];
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
}
interface PdfPage {
  getTextContent(): Promise<{
    items: Array<{
      str: string;
      width?: number;
      height?: number;
      transform?: number[];
    }>;
  }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray?: unknown[] }>;
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
let PDFJS_SAVE_OP: number | null = null;
let PDFJS_RESTORE_OP: number | null = null;
let PDFJS_TRANSFORM_OP: number | null = null;
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
  PDFJS_SAVE_OP = typeof OPS.save === 'number' ? OPS.save : null;
  PDFJS_RESTORE_OP = typeof OPS.restore === 'number' ? OPS.restore : null;
  PDFJS_TRANSFORM_OP = typeof OPS.transform === 'number' ? OPS.transform : null;
  pdfjsImageOpsInit = true;
}

// Real affixed-label raster images are usually hundreds of pixels in both
// dimensions. COLA certificate chrome can also contain image XObjects, but
// those are often thin signatures/seals. Use size, not page order, as the
// signal for "this page has label artwork worth OCRing".
const MIN_LABEL_IMAGE_AREA = 250_000;
const MIN_LABEL_IMAGE_SHORT_SIDE = 300;
const MIN_LABEL_IMAGE_LONG_SIDE = 500;

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
  const viewport = page.getViewport({ scale: 1 });
  const textItems = text.items.flatMap(toPdfTextItem);
  const items = textItems.map((t) => t.text);
  const joined = items.join(' ');
  const renderedPageSize = {
    width: viewport.width * RENDER_SCALE,
    height: viewport.height * RENDER_SCALE,
  };
  const imageStats = extractImageDraws(opList, renderedPageSize);
  const largestImageArea = imageStats.reduce(
    (max, image) => Math.max(max, image.width * image.height),
    0,
  );
  const hasImageContent = imageStats.length > 0;
  const hasLabelImageContent = imageStats.some(isSubstantialLabelImage);
  const labelImageRegions = imageStats
    .filter(isSubstantialLabelImage)
    .map((image) => image.rect);
  return {
    pageNumber,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    textItems,
    formMarkerHits: FORM_PAGE_MARKERS.filter((m) => joined.includes(m)).length,
    hasLabelMarker: LABEL_PAGE_MARKERS.some((m) => joined.includes(m)),
    frontMarkerHits: FRONT_LABEL_MARKERS.filter((m) => joined.includes(m)).length,
    backMarkerHits: BACK_LABEL_MARKERS.filter((m) => joined.includes(m)).length,
    nonEmptyTextItems: items.filter((s) => s.trim().length > 0).length,
    hasImageContent,
    hasLabelImageContent,
    largestImageArea,
    labelImageRegions,
  };
}

function extractImageDraws(
  opList: { fnArray: number[]; argsArray?: unknown[] },
  renderedPageSize: { width: number; height: number },
): Array<{ width: number; height: number; rect: PixelRect }> {
  const draws: Array<{ width: number; height: number; rect: PixelRect }> = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];

  for (let idx = 0; idx < opList.fnArray.length; idx++) {
    const fn = opList.fnArray[idx]!;
    const args = opList.argsArray?.[idx];
    if (fn === PDFJS_SAVE_OP) {
      stack.push([...ctm] as Matrix);
      continue;
    }
    if (fn === PDFJS_RESTORE_OP) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
    if (fn === PDFJS_TRANSFORM_OP) {
      const next = matrixFromArgs(args);
      if (next) ctm = next;
      continue;
    }
    if (!PDFJS_IMAGE_OPS.has(fn)) continue;
    const dimensions = imageDimensionsFromArgs(args);
    if (!dimensions) continue;
    const rect = clampRect(expandRect(rectFromUnitSquare(ctm), 4), renderedPageSize);
    if (!rect) continue;
    draws.push({ ...dimensions, rect });
  }
  return draws;
}

type Matrix = [number, number, number, number, number, number];

function matrixFromArgs(args: unknown): Matrix | null {
  if (!Array.isArray(args) || args.length < 6) return null;
  const values = args.slice(0, 6).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values as Matrix;
}

function rectFromUnitSquare(matrix: Matrix): PixelRect {
  const points = [
    applyMatrix(matrix, 0, 0),
    applyMatrix(matrix, 1, 0),
    applyMatrix(matrix, 0, 1),
    applyMatrix(matrix, 1, 1),
  ];
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

function expandRect(rect: PixelRect, padding: number): PixelRect {
  return {
    x0: rect.x0 - padding,
    y0: rect.y0 - padding,
    x1: rect.x1 + padding,
    y1: rect.y1 + padding,
  };
}

function clampRect(
  rect: PixelRect,
  bounds: { width: number; height: number },
): PixelRect | null {
  const clamped = {
    x0: Math.max(0, Math.min(bounds.width, rect.x0)),
    y0: Math.max(0, Math.min(bounds.height, rect.y0)),
    x1: Math.max(0, Math.min(bounds.width, rect.x1)),
    y1: Math.max(0, Math.min(bounds.height, rect.y1)),
  };
  if (clamped.x1 - clamped.x0 <= 1 || clamped.y1 - clamped.y0 <= 1) return null;
  return clamped;
}

function imageDimensionsFromArgs(args: unknown): { width: number; height: number } | null {
  if (!Array.isArray(args)) return null;
  const width = Number(args[1]);
  const height = Number(args[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function isSubstantialLabelImage(image: { width: number; height: number }): boolean {
  const shortSide = Math.min(image.width, image.height);
  const longSide = Math.max(image.width, image.height);
  return (
    image.width * image.height >= MIN_LABEL_IMAGE_AREA ||
    (shortSide >= MIN_LABEL_IMAGE_SHORT_SIDE && longSide >= MIN_LABEL_IMAGE_LONG_SIDE)
  );
}

function toPdfTextItem(item: {
  str: string;
  width?: number;
  height?: number;
  transform?: number[];
}): PdfTextItem[] {
  const text = item.str.trim();
  if (!text) return [];
  const transform = item.transform ?? [];
  const x = Number(transform[4] ?? 0);
  const y = Number(transform[5] ?? 0);
  const width = Number(item.width ?? 0);
  const transformedHeight = Math.hypot(
    Number(transform[2] ?? 0),
    Number(transform[3] ?? 0),
  );
  const height = Number(item.height ?? (transformedHeight || 0));
  return [{ text, x, y, width, height }];
}

/**
 * Pick which pages to render and tag them with their content kind. Strategy:
 *   1. Pick the single page with the most form markers — that's where the
 *      Item 1–18 fields live (tagged 'form').
 *   2. Pick every non-form page with a substantial embedded image XObject.
 *      Tag it as neutral 'label'. We do not need to know whether it is front,
 *      back, neck, keg collar, or combined artwork to extract required facts.
 *   3. Fallback for pages that have a label marker but no image signal
 *      (older synthetic fixtures, vector labels, odd exports): tag as 'label'.
 *   4. If no label tags get assigned, the form page also holds the label —
 *      single-page synthetic fixture path, tag as neutral 'form+label'.
 *   5. Cap at MAX_PAGES_TO_RENDER, preserving PDF page order.
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

  const selected = new Map<number, RenderedPageKind>();
  selected.set(formPage.pageNumber, 'form');

  // Step 2 — label-image pages. The verifier scans every selected label
  // page for the required facts, so side classification would only add risk.
  for (const c of classes) {
    if (c.pageNumber === formPage.pageNumber) continue;
    if (c.hasLabelImageContent) {
      selected.set(c.pageNumber, 'label');
    }
  }

  // Step 3 — Pages with a generic label marker that we couldn't identify by
  // image metadata. Use this only when no substantial label image was found;
  // otherwise marker/certificate chrome pages just add OCR cost and noise.
  const hasLabelImagePage = Array.from(selected.values()).some((kind) => kind === 'label');
  if (!hasLabelImagePage) {
    for (const c of classes) {
      if (selected.has(c.pageNumber)) continue;
      if (c.pageNumber === formPage.pageNumber) continue;
      if (c.hasLabelMarker) {
        selected.set(c.pageNumber, 'label');
      }
    }
  }

  // Step 5 — Single-page synthetic fixture path: nothing was tagged as
  // artwork. The form page also holds the label.
  const hasAnyArtwork = Array.from(selected.values()).some(
    (k) => k !== 'form',
  );
  if (!hasAnyArtwork) {
    selected.set(formPage.pageNumber, 'form+label');
  }

  return Array.from(selected.entries())
    .map(([pageNumber, kind]) => ({ pageNumber, kind }))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .slice(0, MAX_PAGES_TO_RENDER);
}

export const __renderTesting = {
  pickPagesToRender,
};

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

async function maskPngToRegions(png: Buffer, regions: PixelRect[]): Promise<Buffer> {
  if (regions.length === 0) return png;
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, image.width, image.height);
  for (const region of regions) {
    const x = Math.floor(region.x0);
    const y = Math.floor(region.y0);
    const width = Math.ceil(region.x1 - region.x0);
    const height = Math.ceil(region.y1 - region.y0);
    if (width <= 0 || height <= 0) continue;
    ctx.drawImage(image, x, y, width, height, x, y, width, height);
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
    const classByPage = new Map(classes.map((c) => [c.pageNumber, c]));
    const rendered: RenderedPage[] = [];
    for (const { pageNumber, kind } of picked) {
      const page = await doc.getPage(pageNumber);
      try {
        const classification = classByPage.get(pageNumber);
        const png = await renderPage(page);
        const labelImageRegions = classification?.labelImageRegions ?? [];
        const ocrPng =
          kind.includes('label') && labelImageRegions.length > 0
            ? await maskPngToRegions(png, labelImageRegions)
            : undefined;
        rendered.push({
          pageNumber,
          kind,
          png,
          ocrPng,
          pageWidth: classification?.pageWidth,
          pageHeight: classification?.pageHeight,
          textItems: classification?.textItems,
          labelImageRegions,
        });
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

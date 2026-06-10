import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  Path2D,
  type Canvas,
} from '@napi-rs/canvas';

const TARGET_DPI = 200;
const PDF_DEFAULT_DPI = 72;
const RENDER_SCALE = TARGET_DPI / PDF_DEFAULT_DPI;

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

export async function renderPageOne(pdfBuffer: Uint8Array | Buffer): Promise<Buffer> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new PdfRenderError('Empty PDF buffer.');
  }
  ensurePolyfills();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs spawns a Web Worker by default to do parsing; in Node we have to
  // point GlobalWorkerOptions at the worker bundle so it can be loaded
  // synchronously. The legacy build ships the worker at a known location.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { createRequire } = (await import('node:module')) as unknown as {
      createRequire: (url: string) => { resolve: (p: string) => string };
    };
    const req = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = req.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
    );
  }

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      // `canvasFactory` is supported on the pdfjs runtime but not in its public
      // type — cast to bypass the gap rather than ship a misleading type for it.
      canvasFactory: new NodeCanvasFactory(),
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  } catch (e) {
    throw new PdfRenderError(`Could not parse PDF: ${(e as Error).message}`, {
      cause: e,
    });
  }

  if (doc.numPages < 1) {
    throw new PdfRenderError('PDF has no pages.');
  }

  const page = await doc.getPage(1);
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
    await doc.cleanup();
  }

  return canvas.toBuffer('image/png');
}

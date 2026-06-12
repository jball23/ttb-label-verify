/**
 * Tesseract.js worker — server-side, lazy + module-cached (KD7).
 *
 * Exposes one function: `getWorker()` returns a ready-to-use Tesseract worker.
 * The worker is created on first call and reused for every subsequent call in
 * the same Node process. Vercel reuses warm lambdas across requests, so cold
 * starts pay the ~500ms `eng.traineddata` load once and warm requests pay
 * nothing.
 *
 * **Path resolution** — Tesseract.js needs to locate four runtime artifacts:
 * the WASM binary + its JS wrapper, the worker-thread entrypoint, and the
 * `eng.traineddata` language file. Webpack's static analyzer rewrites
 * `createRequire().resolve()` and similar lookups into webpack module IDs at
 * build time, which then fail when handed to `fs.readFile`. We compute paths
 * with `process.cwd() + path.join(...)` instead — same dodge as the pdfjs
 * worker (`src/lib/pdf/render.ts`). Vercel's nft can't trace these runtime-
 * computed paths either, so `next.config.mjs.outputFileTracingIncludes`
 * force-includes the file list with the `/api/verify` lambda.
 *
 * Plan unit: U3.
 * Plan KDs: KD7 (lazy + cached, single worker, sequential OCR).
 */
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

const REPO_ROOT = process.cwd();

const TESSDATA_PATH = path.join(REPO_ROOT, 'tessdata');
const TESSERACT_CORE_PATH = path.join(
  REPO_ROOT,
  'node_modules',
  'tesseract.js-core',
);
const WORKER_SCRIPT_PATH = path.join(
  REPO_ROOT,
  'node_modules',
  'tesseract.js',
  'src',
  'worker-script',
  'node',
  'index.js',
);

let cachedWorker: Promise<Worker> | null = null;

/**
 * Returns a Tesseract worker initialised with the English language data.
 * The worker is created on first call and reused across all subsequent calls
 * in the lifetime of the Node process.
 *
 * Concurrent callers receive the same in-flight init promise (no duplicate
 * `createWorker` calls under load).
 */
export function getWorker(): Promise<Worker> {
  if (!cachedWorker) {
    cachedWorker = createWorker('eng', undefined, {
      langPath: TESSDATA_PATH,
      corePath: TESSERACT_CORE_PATH,
      workerPath: WORKER_SCRIPT_PATH,
      gzip: false, // tessdata/eng.traineddata is the raw uncompressed file
      // Silence verbose recognize progress; callers can wire a logger if needed.
      logger: () => {},
    }).catch((err: unknown) => {
      // If init fails, clear the cache so the next request can retry.
      cachedWorker = null;
      throw err;
    });
  }
  return cachedWorker;
}

/**
 * Test-only — reset the cached worker so each test case starts fresh.
 */
export function resetWorkerForTesting(): void {
  cachedWorker = null;
}

export interface WordRect {
  text: string;
  confidence: number; // 0-100
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPageResult {
  words: WordRect[];
  meanConfidence: number;
  ocrLatencyMs: number;
}

/**
 * Run OCR on a single PNG buffer and return its flattened word list.
 *
 * Tesseract returns a `blocks > paragraphs > lines > words` hierarchy; we
 * flatten to a word array because the downstream field assigners only care
 * about per-word `text + bbox + confidence` triples (KD2: per-word bbox list).
 *
 * Uses the Worker API with `{ blocks: true, text: true }` — the convenience
 * `Tesseract.recognize(image)` does NOT return the blocks hierarchy in v6
 * and would leave every word's bbox unavailable. Confirmed in the U2 spike.
 */
export async function runOcr(png: Buffer | Uint8Array): Promise<OcrPageResult> {
  const worker = await getWorker();
  const start = Date.now();
  const result = await worker.recognize(
    Buffer.isBuffer(png) ? png : Buffer.from(png),
    {},
    { blocks: true, text: true },
  );
  const ocrLatencyMs = Date.now() - start;

  const blocks = result.data.blocks ?? [];
  const words: WordRect[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          words.push({
            text: word.text,
            confidence: word.confidence,
            bbox: word.bbox,
          });
        }
      }
    }
  }
  const meanConfidence =
    words.length === 0
      ? 0
      : Math.round(words.reduce((a, w) => a + w.confidence, 0) / words.length);
  return { words, meanConfidence, ocrLatencyMs };
}

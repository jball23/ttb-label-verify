/**
 * Tesseract.js worker pool — server-side, lazy + module-cached.
 *
 * Exposes `runOcr(png)` (page-level recognise) and `getWorker()` (raw worker
 * handle, used by tests). Both are backed by a fixed-size pool of N Tesseract
 * workers; pool size defaults to 2. Workers are created lazily on first
 * acquire, so a single-page request still pays one cold start, not N. Vercel
 * reuses warm lambdas across requests, so warm pages pay nothing.
 *
 * Concurrency model:
 *   - Each `runOcr` call ACQUIRES a free worker, runs `recognize()`, then
 *     RELEASES the slot. Up to POOL_SIZE recognises run in parallel.
 *   - A separate caller using `getWorker()` (tests only) always gets slot 0's
 *     worker — identity-stable so the "concurrent callers see the same
 *     instance" expectation still holds.
 *   - Excess `runOcr` callers wait on a FIFO waiter queue and wake when a
 *     slot frees.
 *
 * **Path resolution** — Tesseract.js needs four runtime artifacts: the WASM
 * binary + its JS wrapper, the worker-thread entrypoint, and the
 * `eng.traineddata` language file. Webpack's static analyzer rewrites
 * `createRequire().resolve()` and similar lookups into webpack module IDs at
 * build time, which then fail when handed to `fs.readFile`. We compute paths
 * with `process.cwd() + path.join(...)` instead — same dodge as the pdfjs
 * worker (`src/lib/pdf/render.ts`). Vercel's nft can't trace these runtime-
 * computed paths either, so `next.config.mjs.outputFileTracingIncludes`
 * force-includes the file list with the `/api/verify` lambda.
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

// Default to 2. Tesseract.js workers are single-threaded internally — a worker
// recognise() blocks the worker until it finishes — so parallel OCR requires
// distinct worker instances. Two is enough to overlap the 3–4 label pages a
// typical COLA carries against the form page's render+decode while staying
// well within Vercel's 1 GB lambda memory floor (one warm worker ≈ 50 MB
// trained-data + WASM heap).
const POOL_SIZE = Number(process.env.OCR_POOL_SIZE ?? 2);

interface Slot {
  promise: Promise<Worker> | null;
  busy: boolean;
}

const pool: Slot[] = Array.from({ length: POOL_SIZE }, () => ({
  promise: null,
  busy: false,
}));
const waiters: Array<() => void> = [];

function initSlot(slot: Slot): Promise<Worker> {
  if (slot.promise) return slot.promise;
  slot.promise = createWorker('eng', undefined, {
    langPath: TESSDATA_PATH,
    corePath: TESSERACT_CORE_PATH,
    workerPath: WORKER_SCRIPT_PATH,
    gzip: false, // tessdata/eng.traineddata is the raw uncompressed file
    logger: () => {},
  }).catch((err: unknown) => {
    slot.promise = null;
    throw err;
  });
  return slot.promise;
}

function notifyWaiter(): void {
  const next = waiters.shift();
  if (next) next();
}

/**
 * Acquire a worker from the pool. The returned `release()` MUST be called
 * once recognise() resolves so the slot can serve the next caller. The
 * acquire/release dance is wrapped in a try/finally inside `runOcr`; callers
 * outside this module shouldn't drive it directly.
 *
 * Find + busy-set happens in one synchronous tick so two simultaneous acquires
 * can't both claim the same slot. The waiter queue is FIFO — strictly one
 * waiter wakes per release, so the queue can't double-serve.
 */
async function acquire(): Promise<{ worker: Worker; release: () => void }> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const slot = pool.find((s) => !s.busy);
    if (slot) {
      slot.busy = true;
      try {
        const worker = await initSlot(slot);
        return {
          worker,
          release: () => {
            slot.busy = false;
            notifyWaiter();
          },
        };
      } catch (err) {
        slot.busy = false;
        notifyWaiter();
        throw err;
      }
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
}

/**
 * Returns slot 0's worker instance. Used by tests for the
 * "concurrent callers receive the same instance" expectation, and as a
 * shutdown handle for `afterAll(() => worker.terminate())`. Production code
 * should call `runOcr` instead — that path uses the full pool.
 */
export function getWorker(): Promise<Worker> {
  return initSlot(pool[0]!);
}

/**
 * Test-only — clear every slot so each test case starts cold.
 */
export function resetWorkerForTesting(): void {
  for (const s of pool) {
    s.promise = null;
    s.busy = false;
  }
  waiters.length = 0;
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
 * about per-word `text + bbox + confidence` triples.
 *
 * Uses the Worker API with `{ blocks: true, text: true }` — the convenience
 * `Tesseract.recognize(image)` does NOT return the blocks hierarchy in v6
 * and would leave every word's bbox unavailable. Confirmed in the U2 spike.
 */
export async function runOcr(png: Buffer | Uint8Array): Promise<OcrPageResult> {
  const { worker, release } = await acquire();
  const start = Date.now();
  try {
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
  } finally {
    release();
  }
}

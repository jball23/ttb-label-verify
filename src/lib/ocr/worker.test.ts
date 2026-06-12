import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { getWorker, resetWorkerForTesting, runOcr } from './worker';

/**
 * Worker tests use real Tesseract.js against a small synthesized PNG. We don't
 * mock the WASM init — there's no value in proving the wrapper works on a fake
 * worker, and the path-resolution logic is exactly what we need to exercise.
 *
 * These tests are slow (~3-5s for the first one because the worker cold-loads
 * eng.traineddata) but they run with no external dependencies — no network,
 * no API keys.
 */

function makeTestPng(text: string): Buffer {
  // White background, large black text — easy for Tesseract to read with
  // very high confidence. We use a synthetic image so the test doesn't depend
  // on any fixture PDF being on disk.
  const width = 400;
  const height = 80;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 48px Arial';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, height / 2);
  return canvas.toBuffer('image/png');
}

describe('ocr/worker', () => {
  beforeEach(() => {
    resetWorkerForTesting();
  });

  afterAll(async () => {
    // Terminate the worker so vitest can exit cleanly.
    const worker = await getWorker().catch(() => null);
    if (worker) await worker.terminate();
    resetWorkerForTesting();
  });

  it('getWorker resolves once and caches across concurrent callers', async () => {
    const [a, b, c] = await Promise.all([getWorker(), getWorker(), getWorker()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  }, 30_000);

  it('runOcr returns words with per-word bbox + confidence', async () => {
    const png = makeTestPng('HELLO');
    const result = await runOcr(png);
    expect(result.words.length).toBeGreaterThan(0);
    const helloWord = result.words.find((w) => /hello/i.test(w.text));
    expect(helloWord).toBeDefined();
    expect(helloWord!.confidence).toBeGreaterThan(60);
    expect(helloWord!.bbox.x0).toBeGreaterThanOrEqual(0);
    expect(helloWord!.bbox.x1).toBeGreaterThan(helloWord!.bbox.x0);
    expect(helloWord!.bbox.y1).toBeGreaterThan(helloWord!.bbox.y0);
  }, 30_000);

  it('runOcr reports mean confidence and latency', async () => {
    const png = makeTestPng('WORLD');
    const result = await runOcr(png);
    expect(result.meanConfidence).toBeGreaterThan(0);
    expect(result.meanConfidence).toBeLessThanOrEqual(100);
    expect(result.ocrLatencyMs).toBeGreaterThan(0);
  }, 30_000);
});

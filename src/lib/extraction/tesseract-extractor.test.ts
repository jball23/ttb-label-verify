import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TesseractExtractor, type VlmSingleFieldExtractor } from './tesseract-extractor';
import { renderApplicationPages } from '../pdf/render';
import { getWorker, resetWorkerForTesting } from '../ocr/worker';

/**
 * Integration tests against real cola PDFs from the U2 spike. The Tesseract
 * worker is real (no mocks) — these prove the full OCR + assignment pipeline.
 * Each test takes ~3-8s; the suite times out generously.
 */

const COLA_BOUCHARD = path.resolve(
  __dirname,
  '../../../public/samples/cola/26086001000651-bouchard-aine-fils.pdf',
);

describe('tesseract-extractor (integration against real cola)', () => {
  afterAll(async () => {
    const worker = await getWorker().catch(() => null);
    if (worker) await worker.terminate();
    resetWorkerForTesting();
  });

  it('Bouchard — extracts Government Warning + ABV + producer + country', async () => {
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    expect(result).toBeDefined();
    expect(result.application).toBeDefined();
    expect(result.label).toBeDefined();
    expect(result.bboxes).toBeDefined();

    // The back label is page 4 in Bouchard. It carries the canonical GW;
    // Tesseract reads it at conf ~86 in the U2 spike. Match via the
    // 'government' + 'warning' prefix (the OCR'd text has spacing /
    // punctuation drift from canonical that's irrelevant for parity).
    expect(result.label.governmentWarning.text).toBeTruthy();
    expect(result.label.governmentWarning.text?.toLowerCase()).toMatch(/government.*warning/);

    // ABV — "12.6%" is on the back label.
    expect(result.label.abv).toBeTruthy();
    expect(result.label.abv).toMatch(/\b12\.6\s*%/);

    // Producer attribution — "IMPORTED BY" on the back label.
    expect(result.label.producer).toBeTruthy();
    expect(result.label.producer?.toLowerCase()).toMatch(/imported\s+by/);

    // Country of origin — "PRODUCT OF FRANCE" on the back label.
    expect(result.label.countryOfOrigin).toBeTruthy();
    expect(result.label.countryOfOrigin?.toLowerCase()).toMatch(/product\s+of/);
  }, 60_000);

  it('Bouchard — populates bboxes sidecar for matched fields', async () => {
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    // GW bbox: tesseract source, multiple words on page 4, mean conf 80+.
    const gwBbox = result.bboxes?.['label.governmentWarning'];
    expect(gwBbox).toBeDefined();
    expect(gwBbox?.source).toBe('tesseract');
    expect(gwBbox?.words.length).toBeGreaterThan(5);
    expect(gwBbox?.page).toBe(4);
    expect(gwBbox?.meanConfidence).toBeGreaterThan(70);

    // ABV bbox.
    const abvBbox = result.bboxes?.['label.abv'];
    expect(abvBbox).toBeDefined();
    expect(abvBbox?.source).toBe('tesseract');
  }, 60_000);

  it('VLM fallback fires for fields Tesseract did not find', async () => {
    // Use a stub fallback that records which fields were requested.
    const requested: string[] = [];
    const stub: VlmSingleFieldExtractor = {
      async extractField({ fieldPath }) {
        requested.push(fieldPath);
        return 'STUB-FALLBACK-VALUE';
      },
    };
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor({ vlmFallback: stub });
    const result = await extractor.extractFromPages(pages);

    // Tesseract should NOT have produced a brand name for the back-label-
    // dominant Bouchard (no 'front' page tagged in this fixture has a
    // clear brand wordmark). Fallback should fire for at least some fields.
    expect(requested.length).toBeGreaterThan(0);

    // Every fallback-supplied field is marked source: 'vlm' with no bbox.
    for (const fieldPath of requested) {
      const bbox = result.bboxes?.[fieldPath as keyof NonNullable<typeof result.bboxes>];
      expect(bbox?.source).toBe('vlm');
      expect(bbox?.words).toEqual([]);
      expect(bbox?.meanConfidence).toBeNull();
    }
  }, 60_000);
});

#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * U1 — Capture GPT-4o baseline accuracy + latency on the 20 real cola samples.
 *
 * Reads every PDF in public/samples/cola/, renders pages, runs the current
 * GPT-4o extractor with EXTRACT_PROVENANCE=true (so we capture model-provided
 * bboxes for fair comparison), and writes a JSON snapshot. The U5 parity gate
 * reads this snapshot when validating the Tesseract-based extractor.
 *
 * Run from repo root: `npx tsx scripts/baseline-capture.ts`
 *
 * Cost: ~$0.50-1.50 of OpenAI API spend (20 PDFs × ~$0.03 each on gpt-4o).
 *
 * Origin plan: docs/plans/2026-06-11-001-feat-tesseract-bbox-detail-view-plan.md
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Force provenance ON for baseline regardless of .env.local default.
process.env.EXTRACT_PROVENANCE = 'true';

import { getExtractor } from '../src/lib/extraction/factory';
import { renderApplicationPages } from '../src/lib/pdf/render';
import { resetEnvForTesting } from '../src/lib/env';
import { type ExtractedDocument } from '../src/lib/extraction/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'public', 'samples', 'cola');
const OUTPUT_DIR = path.join(REPO_ROOT, 'evals', 'baselines');
const OUTPUT_FILE = path.join(OUTPUT_DIR, '2026-06-11-gpt4o-cola.json');

interface BaselineEntry {
  filename: string;
  sizeBytes: number;
  pages: Array<{ pageNumber: number; kind: string; pngSizeBytes: number }>;
  extractionLatencyMs: number;
  renderLatencyMs: number;
  totalLatencyMs: number;
  modelId: string;
  providerName: string;
  promptVersion?: string;
  extraction?: ExtractedDocument;
  errorMessage?: string;
}

interface BaselineSnapshot {
  capturedAt: string;
  extractProvenance: boolean;
  entries: BaselineEntry[];
  summary: {
    totalPdfs: number;
    successCount: number;
    errorCount: number;
    meanRenderLatencyMs: number;
    meanExtractionLatencyMs: number;
    meanTotalLatencyMs: number;
  };
}

async function captureOne(extractor: ReturnType<typeof getExtractor>, pdfPath: string): Promise<BaselineEntry> {
  const filename = path.basename(pdfPath);
  const pdfBuffer = fs.readFileSync(pdfPath);
  const sizeBytes = pdfBuffer.length;

  const renderStart = Date.now();
  let pages;
  try {
    pages = await renderApplicationPages(pdfBuffer);
  } catch (e) {
    return {
      filename,
      sizeBytes,
      pages: [],
      extractionLatencyMs: 0,
      renderLatencyMs: Date.now() - renderStart,
      totalLatencyMs: Date.now() - renderStart,
      modelId: extractor.modelId,
      providerName: extractor.providerName,
      errorMessage: `Render failed: ${(e as Error).message}`,
    };
  }
  const renderLatencyMs = Date.now() - renderStart;

  const pagesSummary = pages.map((p) => ({
    pageNumber: p.pageNumber,
    kind: p.kind,
    pngSizeBytes: p.png.length,
  }));

  const extractStart = Date.now();
  let extraction: ExtractedDocument | undefined;
  let errorMessage: string | undefined;
  try {
    extraction = await extractor.extract(
      pages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind, png: p.png })),
    );
  } catch (e) {
    errorMessage = `Extract failed: ${(e as Error).message}`;
  }
  const extractionLatencyMs = Date.now() - extractStart;
  const totalLatencyMs = renderLatencyMs + extractionLatencyMs;

  return {
    filename,
    sizeBytes,
    pages: pagesSummary,
    renderLatencyMs,
    extractionLatencyMs,
    totalLatencyMs,
    modelId: extractor.modelId,
    providerName: extractor.providerName,
    extraction,
    errorMessage,
  };
}

async function main(): Promise<void> {
  resetEnvForTesting(); // pick up EXTRACT_PROVENANCE=true forced above
  const extractor = getExtractor();
  console.log(`Extractor: ${extractor.providerName} / ${extractor.modelId}`);
  console.log(`EXTRACT_PROVENANCE=${process.env.EXTRACT_PROVENANCE}`);

  const filenames = fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  console.log(`Found ${filenames.length} PDFs in public/samples/cola/`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const entries: BaselineEntry[] = [];
  for (let i = 0; i < filenames.length; i++) {
    const filename = filenames[i]!;
    process.stdout.write(`[${i + 1}/${filenames.length}] ${filename} ... `);
    const entry = await captureOne(extractor, path.join(SAMPLES_DIR, filename));
    entries.push(entry);
    if (entry.errorMessage) {
      console.log(`ERROR (${entry.totalLatencyMs}ms): ${entry.errorMessage}`);
    } else {
      console.log(
        `ok render=${entry.renderLatencyMs}ms extract=${entry.extractionLatencyMs}ms pages=[${entry.pages.map((p) => `${p.pageNumber}:${p.kind}`).join(',')}]`,
      );
    }
  }

  const successEntries = entries.filter((e) => !e.errorMessage);
  const errorEntries = entries.filter((e) => e.errorMessage);
  const snapshot: BaselineSnapshot = {
    capturedAt: new Date().toISOString(),
    extractProvenance: process.env.EXTRACT_PROVENANCE === 'true',
    entries,
    summary: {
      totalPdfs: entries.length,
      successCount: successEntries.length,
      errorCount: errorEntries.length,
      meanRenderLatencyMs:
        successEntries.length === 0
          ? 0
          : Math.round(successEntries.reduce((a, e) => a + e.renderLatencyMs, 0) / successEntries.length),
      meanExtractionLatencyMs:
        successEntries.length === 0
          ? 0
          : Math.round(
              successEntries.reduce((a, e) => a + e.extractionLatencyMs, 0) / successEntries.length,
            ),
      meanTotalLatencyMs:
        successEntries.length === 0
          ? 0
          : Math.round(successEntries.reduce((a, e) => a + e.totalLatencyMs, 0) / successEntries.length),
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(snapshot, null, 2));
  console.log('\n=== Baseline summary ===');
  console.log(`Total PDFs:           ${snapshot.summary.totalPdfs}`);
  console.log(`Successful:           ${snapshot.summary.successCount}`);
  console.log(`Errors:               ${snapshot.summary.errorCount}`);
  console.log(`Mean render latency:  ${snapshot.summary.meanRenderLatencyMs}ms`);
  console.log(`Mean extract latency: ${snapshot.summary.meanExtractionLatencyMs}ms`);
  console.log(`Mean total latency:   ${snapshot.summary.meanTotalLatencyMs}ms`);
  console.log(`\nWrote: ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

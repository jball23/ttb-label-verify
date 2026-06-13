#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * U5 — Baseline parity gate.
 *
 * Runs the new Tesseract-first extractor (with OpenAI VLM fallback) over
 * the 20 real cola samples and diffs each PDF's extraction against the
 * U1 GPT-4o baseline snapshot. Surfaces accuracy delta per field, mean
 * latency delta, and fallback-density per field.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.LABEL_EXTRACTOR = 'tesseract';

import { getExtractor } from '../src/lib/extraction/factory';
import { renderApplicationPages } from '../src/lib/pdf/render';
import { resetEnvForTesting } from '../src/lib/env';
import { type ExtractedDocument } from '../src/lib/extraction/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'public', 'samples', 'cola');
const OUTPUT_DIR = path.join(REPO_ROOT, 'evals', 'baselines');
const BASELINE_FILE = path.join(OUTPUT_DIR, '2026-06-11-gpt4o-cola.json');
const NEW_BASELINE_FILE = path.join(OUTPUT_DIR, '2026-06-11-tesseract-cola.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'comparison-report.md');

const ACCURACY_TOLERANCE = 0.05;

interface BaselineEntry {
  filename: string;
  sizeBytes: number;
  pages: Array<{ pageNumber: number; kind: string; pngSizeBytes: number }>;
  extractionLatencyMs: number;
  renderLatencyMs: number;
  totalLatencyMs: number;
  modelId: string;
  providerName: string;
  extraction?: ExtractedDocument;
  errorMessage?: string;
}

interface BaselineSnapshot {
  capturedAt: string;
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

const SCORE_FIELDS_LABEL = ['brandName', 'abv', 'netContents', 'producer', 'countryOfOrigin'] as const;
const SCORE_FIELDS_APP = ['brandName', 'fancifulName', 'productType'] as const;

interface FieldDiff {
  field: string;
  baselineValue: string | null;
  newValue: string | null;
  exactMatch: boolean;
  presenceMatch: boolean;
}

interface PerSampleResult {
  filename: string;
  baselineLatencyMs: number;
  newLatencyMs: number;
  latencyDeltaMs: number;
  fieldDiffs: FieldDiff[];
  accuracy: number;
  fallbackFieldCount: number;
  totalFieldCount: number;
  errorMessage?: string;
}

function normalizeForCompare(v: string | null | undefined): string {
  if (!v) return '';
  return v.trim().toLowerCase().replace(/[^a-z0-9.%/ ]+/g, '').replace(/\s+/g, ' ').trim();
}

function presenceMatch(a: string | null, b: string | null): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na === '' && nb === '') return true;
  if (na === '' || nb === '') return false;
  const tokensA = na.split(' ').filter((t) => t.length >= 3);
  const tokensB = nb.split(' ').filter((t) => t.length >= 3);
  if (tokensA.length === 0 || tokensB.length === 0) return na === nb;
  return tokensA.some((t) => tokensB.some((u) => t.includes(u) || u.includes(t)));
}

async function runOne(extractor: ReturnType<typeof getExtractor>, pdfPath: string, filename: string): Promise<{ extraction?: ExtractedDocument; latencyMs: number; error?: string }> {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const start = Date.now();
  try {
    const pages = await renderApplicationPages(pdfBuffer);
    const extraction = await extractor.extract(
      pages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind, png: p.png })),
    );
    return { extraction, latencyMs: Date.now() - start };
  } catch (e) {
    return { latencyMs: Date.now() - start, error: `${filename}: ${(e as Error).message}` };
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`Baseline not found at ${BASELINE_FILE}. Run scripts/baseline-capture.ts first.`);
    process.exit(1);
  }
  const baseline: BaselineSnapshot = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  console.log(`Loaded baseline with ${baseline.entries.length} entries (mean total ${baseline.summary.meanTotalLatencyMs}ms).`);

  resetEnvForTesting();
  const extractor = getExtractor();
  console.log(`New extractor: ${extractor.providerName} / ${extractor.modelId}`);

  const newEntries: BaselineEntry[] = [];
  const sampleResults: PerSampleResult[] = [];

  for (let i = 0; i < baseline.entries.length; i++) {
    const baseEntry = baseline.entries[i]!;
    process.stdout.write(`[${i + 1}/${baseline.entries.length}] ${baseEntry.filename} ... `);
    const result = await runOne(extractor, path.join(SAMPLES_DIR, baseEntry.filename), baseEntry.filename);

    if (result.error || !result.extraction) {
      console.log(`ERROR: ${result.error ?? 'no extraction returned'}`);
      newEntries.push({
        filename: baseEntry.filename,
        sizeBytes: baseEntry.sizeBytes,
        pages: baseEntry.pages,
        renderLatencyMs: 0,
        extractionLatencyMs: result.latencyMs,
        totalLatencyMs: result.latencyMs,
        modelId: extractor.modelId,
        providerName: extractor.providerName,
        errorMessage: result.error,
      });
      sampleResults.push({
        filename: baseEntry.filename,
        baselineLatencyMs: baseEntry.totalLatencyMs,
        newLatencyMs: result.latencyMs,
        latencyDeltaMs: result.latencyMs - baseEntry.totalLatencyMs,
        fieldDiffs: [],
        accuracy: 0,
        fallbackFieldCount: 0,
        totalFieldCount: 0,
        errorMessage: result.error,
      });
      continue;
    }

    const extraction = result.extraction;
    newEntries.push({
      filename: baseEntry.filename,
      sizeBytes: baseEntry.sizeBytes,
      pages: baseEntry.pages,
      renderLatencyMs: 0,
      extractionLatencyMs: result.latencyMs,
      totalLatencyMs: result.latencyMs,
      modelId: extractor.modelId,
      providerName: extractor.providerName,
      extraction,
    });

    const baseExtraction = baseEntry.extraction;
    const fieldDiffs: FieldDiff[] = [];
    let presenceMatched = 0;
    let totalScored = 0;
    let fallbackCount = 0;

    for (const f of SCORE_FIELDS_LABEL) {
      const baseValue = (baseExtraction?.label as Record<string, unknown>)?.[f];
      const newValue = (extraction.label as Record<string, unknown>)[f];
      const bv = typeof baseValue === 'string' ? baseValue : null;
      const nv = typeof newValue === 'string' ? newValue : null;
      const matches = presenceMatch(bv, nv);
      fieldDiffs.push({ field: `label.${f}`, baselineValue: bv, newValue: nv, exactMatch: bv === nv, presenceMatch: matches });
      if (matches) presenceMatched++;
      totalScored++;
      const bbox = extraction.bboxes?.[`label.${f}` as keyof NonNullable<typeof extraction.bboxes>];
      if (bbox?.source === 'vlm') fallbackCount++;
    }
    const baseGw = baseExtraction?.label?.governmentWarning?.text ?? null;
    const newGw = extraction.label.governmentWarning.text;
    const gwMatch = presenceMatch(baseGw, newGw);
    fieldDiffs.push({ field: 'label.governmentWarning', baselineValue: baseGw, newValue: newGw, exactMatch: baseGw === newGw, presenceMatch: gwMatch });
    if (gwMatch) presenceMatched++;
    totalScored++;
    const gwBbox = extraction.bboxes?.['label.governmentWarning'];
    if (gwBbox?.source === 'vlm') fallbackCount++;

    for (const f of SCORE_FIELDS_APP) {
      const baseValue = (baseExtraction?.application as Record<string, unknown>)?.[f];
      const newValue = (extraction.application as Record<string, unknown>)[f];
      const bv = typeof baseValue === 'string' ? baseValue : null;
      const nv = typeof newValue === 'string' ? newValue : null;
      const matches = presenceMatch(bv, nv);
      fieldDiffs.push({ field: `application.${f}`, baselineValue: bv, newValue: nv, exactMatch: bv === nv, presenceMatch: matches });
      if (matches) presenceMatched++;
      totalScored++;
      const bbox = extraction.bboxes?.[`application.${f}` as keyof NonNullable<typeof extraction.bboxes>];
      if (bbox?.source === 'vlm') fallbackCount++;
    }

    const accuracy = totalScored === 0 ? 0 : presenceMatched / totalScored;
    sampleResults.push({
      filename: baseEntry.filename,
      baselineLatencyMs: baseEntry.totalLatencyMs,
      newLatencyMs: result.latencyMs,
      latencyDeltaMs: result.latencyMs - baseEntry.totalLatencyMs,
      fieldDiffs,
      accuracy,
      fallbackFieldCount: fallbackCount,
      totalFieldCount: totalScored,
    });
    console.log(`ok ${result.latencyMs}ms acc=${(accuracy * 100).toFixed(0)}% fallback=${fallbackCount}/${totalScored}`);
  }

  fs.writeFileSync(
    NEW_BASELINE_FILE,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        entries: newEntries,
        summary: {
          totalPdfs: newEntries.length,
          successCount: newEntries.filter((e) => !e.errorMessage).length,
          errorCount: newEntries.filter((e) => e.errorMessage).length,
          meanRenderLatencyMs: 0,
          meanExtractionLatencyMs: Math.round(newEntries.reduce((a, e) => a + e.extractionLatencyMs, 0) / newEntries.length),
          meanTotalLatencyMs: Math.round(newEntries.reduce((a, e) => a + e.totalLatencyMs, 0) / newEntries.length),
        },
      },
      null,
      2,
    ),
  );

  const successResults = sampleResults.filter((r) => !r.errorMessage);
  const meanAccuracy = successResults.length === 0 ? 0 : successResults.reduce((a, r) => a + r.accuracy, 0) / successResults.length;
  const meanLatency = sampleResults.length === 0 ? 0 : Math.round(sampleResults.reduce((a, r) => a + r.newLatencyMs, 0) / sampleResults.length);
  const baselineMeanLatency = baseline.summary.meanTotalLatencyMs;
  const totalFallbacks = successResults.reduce((a, r) => a + r.fallbackFieldCount, 0);
  const totalScored = successResults.reduce((a, r) => a + r.totalFieldCount, 0);

  const accuracyDelta = meanAccuracy - 1.0;
  const passAccuracy = accuracyDelta >= -ACCURACY_TOLERANCE;
  const passLatency = meanLatency <= baselineMeanLatency;

  const lines: string[] = [];
  lines.push('# Tesseract baseline parity report');
  lines.push('');
  lines.push(`Captured: ${new Date().toISOString()}`);
  lines.push(`Baseline source: ${path.basename(BASELINE_FILE)} (mean total ${baselineMeanLatency}ms)`);
  lines.push('');
  lines.push(`## Verdict: ${passAccuracy && passLatency ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(`- Mean accuracy: **${(meanAccuracy * 100).toFixed(1)}%** vs baseline (tolerance ±${ACCURACY_TOLERANCE * 100}%)`);
  lines.push(`- Mean total latency: **${meanLatency}ms** (baseline ${baselineMeanLatency}ms — ${meanLatency <= baselineMeanLatency ? '✅' : '❌'})`);
  lines.push(`- VLM fallback density: ${totalFallbacks}/${totalScored} fields (${totalScored === 0 ? 0 : Math.round((totalFallbacks / totalScored) * 100)}%)`);
  lines.push(`- Cost: ~$${(totalFallbacks * 0.001).toFixed(3)} per batch (rough; per-fallback ~$0.001 at gpt-4o pricing)`);
  lines.push('');
  lines.push('## Per-sample summary');
  lines.push('');
  lines.push('| Filename | Baseline latency | New latency | Δ | Accuracy | Fallbacks |');
  lines.push('|----------|-------------------|-------------|----|----------|-----------|');
  for (const r of sampleResults) {
    lines.push(`| ${r.filename} | ${r.baselineLatencyMs}ms | ${r.newLatencyMs}ms | ${r.latencyDeltaMs > 0 ? '+' : ''}${r.latencyDeltaMs}ms | ${(r.accuracy * 100).toFixed(0)}% | ${r.fallbackFieldCount}/${r.totalFieldCount} |`);
  }
  lines.push('');
  lines.push('## Per-field accuracy aggregate');
  lines.push('');
  const fieldAcc: Map<string, { matched: number; total: number }> = new Map();
  for (const r of successResults) {
    for (const d of r.fieldDiffs) {
      const cur = fieldAcc.get(d.field) ?? { matched: 0, total: 0 };
      cur.total++;
      if (d.presenceMatch) cur.matched++;
      fieldAcc.set(d.field, cur);
    }
  }
  lines.push('| Field | Match rate |');
  lines.push('|-------|------------|');
  for (const [field, { matched, total }] of fieldAcc) {
    lines.push(`| ${field} | ${matched}/${total} (${Math.round((matched / total) * 100)}%) |`);
  }
  fs.writeFileSync(REPORT_FILE, lines.join('\n'));

  console.log('\n=== Parity summary ===');
  console.log(`Mean accuracy:   ${(meanAccuracy * 100).toFixed(1)}% (baseline 100%, tolerance ±${ACCURACY_TOLERANCE * 100}%)`);
  console.log(`Mean latency:    ${meanLatency}ms (baseline ${baselineMeanLatency}ms)`);
  console.log(`Fallback rate:   ${totalFallbacks}/${totalScored} fields`);
  console.log(`Verdict:         ${passAccuracy && passLatency ? 'PASS' : 'FAIL'}`);
  console.log(`Report:          ${REPORT_FILE}`);
  console.log(`New snapshot:    ${NEW_BASELINE_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

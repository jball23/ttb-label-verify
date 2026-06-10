#!/usr/bin/env tsx
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getExtractor } from '../src/lib/extraction/factory';
import { getDataset } from './dataset';
import { fieldExtractionAccuracy } from './evaluators/field-extraction-accuracy';
import { governmentWarningMatch } from './evaluators/government-warning-match';
import { getLangfuseClient } from '../src/lib/observability/langfuse';
import { type ExtractedFields } from '../src/lib/extraction/types';

// NOTE: this legacy eval was written against the label-only extractor. The
// dual extractor (PDF input → application + label + provenance) expects a
// rendered COLA page, not a raw label image. The eval still runs, but it
// feeds raw label images into the new extractor and reads only the `.label`
// half of the response — application + provenance will be empty/garbage on
// these inputs. A PDF-based replacement evaluator should be added when there
// is time; the new scenario integration test already exercises the pipeline
// end-to-end against the 5 scenario PDFs.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const FIELD_ACCURACY_THRESHOLD = 0.85;
const WARNING_MATCH_THRESHOLD = 1.0;

interface CaseRun {
  id: string;
  fieldAccuracy: number | null;
  warningMatch: number;
  durationMs: number;
  errorMessage?: string;
}

async function runCase(extractor: ReturnType<typeof getExtractor>, eval_case: ReturnType<typeof getDataset>[number]): Promise<CaseRun> {
  const absoluteImagePath = path.join(REPO_ROOT, eval_case.imagePath);
  if (!fs.existsSync(absoluteImagePath)) {
    return {
      id: eval_case.id,
      fieldAccuracy: null,
      warningMatch: 0,
      durationMs: 0,
      errorMessage: `Image not found at ${eval_case.imagePath}. Add a real label image to run this case.`,
    };
  }

  const image = fs.readFileSync(absoluteImagePath);
  const imageSha = crypto.createHash('sha256').update(image).digest('hex').slice(0, 16);

  const langfuse = getLangfuseClient();
  let trace;
  try {
    trace = langfuse?.trace({
      name: `eval:${eval_case.id}`,
      metadata: {
        evalCaseId: eval_case.id,
        imageSha256: imageSha,
        byteSize: image.byteLength,
      },
    });
  } catch {
    trace = undefined;
  }

  const start = Date.now();
  let actual: ExtractedFields | null = null;
  let errorMessage: string | undefined;
  try {
    const document = await extractor.extract(image);
    actual = document.label;
  } catch (e) {
    errorMessage = (e as Error).message;
  }
  const durationMs = Date.now() - start;

  if (!actual) {
    try {
      (trace as { update?: (d: Record<string, unknown>) => void } | undefined)?.update?.({
        error: errorMessage,
        durationMs,
      });
    } catch {
      /* swallow */
    }
    return {
      id: eval_case.id,
      fieldAccuracy: null,
      warningMatch: 0,
      durationMs,
      errorMessage,
    };
  }

  const accuracy = fieldExtractionAccuracy(eval_case.expected, actual);
  const warning = governmentWarningMatch(eval_case.expected, actual);

  try {
    const t = trace as
      | {
          score?: (s: { name: string; value: number; comment?: string }) => void;
          update?: (d: Record<string, unknown>) => void;
        }
      | undefined;
    t?.score?.({
      name: 'field-extraction-accuracy',
      value: accuracy.aggregate ?? 0,
    });
    t?.score?.({
      name: 'government-warning-match',
      value: warning.score,
      comment: warning.reason,
    });
    t?.update?.({ durationMs, output: actual });
  } catch {
    /* swallow */
  }

  return {
    id: eval_case.id,
    fieldAccuracy: accuracy.aggregate,
    warningMatch: warning.score,
    durationMs,
  };
}

function printTable(runs: CaseRun[]): void {
  console.log('\nEval results:');
  console.log(
    'case'.padEnd(28) +
      'field-acc'.padEnd(12) +
      'warning'.padEnd(10) +
      'ms'.padEnd(8) +
      'status',
  );
  console.log('-'.repeat(70));
  for (const r of runs) {
    const acc = r.fieldAccuracy === null ? 'n/a' : r.fieldAccuracy.toFixed(2);
    const w = r.warningMatch === 1 ? 'pass' : 'fail';
    const status = r.errorMessage ?? 'ok';
    console.log(
      r.id.padEnd(28) +
        acc.padEnd(12) +
        w.padEnd(10) +
        String(r.durationMs).padEnd(8) +
        status,
    );
  }
}

async function main(): Promise<void> {
  console.log('Running eval suite...');
  const dataset = getDataset();
  console.log(`Loaded ${dataset.length} cases.\n`);

  let extractor;
  try {
    extractor = getExtractor();
  } catch (e) {
    console.error(`Failed to construct extractor: ${(e as Error).message}`);
    process.exit(2);
  }

  const runs: CaseRun[] = [];
  for (const case_ of dataset) {
    const result = await runCase(extractor, case_);
    runs.push(result);
  }

  printTable(runs);

  const scored = runs.filter((r) => r.fieldAccuracy !== null && !r.errorMessage);
  const aggregateAccuracy =
    scored.length > 0
      ? scored.reduce((acc, r) => acc + (r.fieldAccuracy ?? 0), 0) / scored.length
      : null;
  const warningPassRate =
    scored.length > 0
      ? scored.filter((r) => r.warningMatch === 1).length / scored.length
      : 0;
  const errors = runs.filter((r) => r.errorMessage);

  console.log(
    `\nAggregate field-accuracy: ${aggregateAccuracy?.toFixed(3) ?? 'n/a'}`,
  );
  console.log(`Warning-match pass rate:  ${warningPassRate.toFixed(3)}`);
  console.log(`Errors:                   ${errors.length} of ${runs.length}`);

  try {
    await getLangfuseClient()?.flushAsync();
  } catch {
    /* swallow */
  }

  if (errors.length === runs.length) {
    console.error(
      '\nNo cases ran successfully. Most likely cause: missing sample images in evals/dataset/images/.',
    );
    console.error('Add real label images at the paths listed in each dataset JSON.');
    process.exit(3);
  }

  if (
    aggregateAccuracy !== null &&
    aggregateAccuracy < FIELD_ACCURACY_THRESHOLD
  ) {
    console.error(
      `\nFAIL: field-accuracy ${aggregateAccuracy.toFixed(3)} below threshold ${FIELD_ACCURACY_THRESHOLD}`,
    );
    process.exit(1);
  }

  if (warningPassRate < WARNING_MATCH_THRESHOLD) {
    console.error(
      `\nFAIL: warning-match pass rate ${warningPassRate.toFixed(3)} below threshold ${WARNING_MATCH_THRESHOLD}`,
    );
    process.exit(1);
  }

  console.log('\nPASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('Eval run crashed:', e);
  process.exit(2);
});

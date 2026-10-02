/* eslint-disable no-console -- a command-line report */
/**
 * Live eval: reads every case with the configured label reader (real API
 * calls), checks the conclusions, and measures latency.
 *
 *   npm run eval                 # cases one at a time, then all at once
 *   npm run eval -- --repeat 3   # run each case 3 times (catches flaky reads)
 *   npm run eval -- --only calypso --repeat 10
 *
 * Exits non-zero if any conclusion is wrong or p95 latency is over 5 s.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkQueue } from '@/lib/concurrency/work-queue';
import { parseEnv } from '@/lib/env';
import { type LabelReader } from '@/lib/labels/label-reader';
import { createLabelReader } from '@/lib/labels/reader-factory';
import { assessReading, readLabel, type LabelReport } from '@/lib/labels/verify-label';
import { EVAL_CASES, type EvalCase } from './cases';

const LATENCY_BUDGET_MS = 5000;
const CONCURRENCY = 6;
const IMAGES = path.resolve(__dirname, '../public/samples/labels');

interface Outcome {
  file: string;
  ms: number;
  verdict: string;
  problems: string[];
}

async function runCase(reader: LabelReader, testCase: EvalCase): Promise<Outcome> {
  const bytes = await readFile(path.join(IMAGES, testCase.file));
  const started = performance.now();
  const reading = await readLabel(reader, { bytes, mimeType: 'image/jpeg' });
  const ms = Math.round(performance.now() - started);
  const report = assessReading(reading, { expected: testCase.expected });
  return {
    file: testCase.file,
    ms,
    verdict: report.verdict,
    problems: judge(testCase, report),
  };
}

function judge(testCase: EvalCase, report: LabelReport): string[] {
  const problems: string[] = [];
  if (!testCase.verdicts.includes(report.verdict)) {
    problems.push(
      `verdict ${report.verdict}, expected ${testCase.verdicts.join(' or ')}`,
    );
    for (const rule of report.rules.filter((r) => r.status !== 'pass')) {
      problems.push(
        `  because ${rule.id} ${rule.status}: ${rule.reason} (read: ${JSON.stringify(rule.value)?.slice(0, 160)})`,
      );
    }
  }
  for (const [id, status] of Object.entries(testCase.rules ?? {})) {
    const rule = report.rules.find((r) => r.id === id);
    if (rule?.status !== status)
      problems.push(
        `${id} ${rule?.status ?? 'missing'}, expected ${status}: ${rule?.reason ?? ''}`,
      );
  }
  for (const [field, status] of Object.entries(testCase.comparisons ?? {})) {
    const comparison = report.comparisons.find((c) => c.field === field);
    if (comparison?.status !== status) {
      problems.push(
        `${field} comparison ${comparison?.status}, expected ${status} (read "${comparison?.found}")`,
      );
    }
  }
  return problems;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
  );
}

async function runAll(
  reader: LabelReader,
  cases: EvalCase[],
  limit: number,
): Promise<{ outcomes: Outcome[]; wallMs: number }> {
  const outcomes: Outcome[] = [];
  const started = performance.now();
  await new Promise<void>((resolve) => {
    let remaining = cases.length;
    const queue = createWorkQueue<EvalCase>(limit, async (testCase) => {
      try {
        outcomes.push(await runCase(reader, testCase));
      } catch (error) {
        outcomes.push({
          file: testCase.file,
          ms: NaN,
          verdict: 'error',
          problems: [(error as Error).message],
        });
      } finally {
        if (--remaining === 0) resolve();
      }
    });
    queue.push(...cases);
  });
  return { outcomes, wallMs: Math.round(performance.now() - started) };
}

function report(
  title: string,
  { outcomes, wallMs }: { outcomes: Outcome[]; wallMs: number },
) {
  console.log(`\n${title}`);
  for (const o of outcomes) {
    console.log(
      `  ${o.problems.length ? '✗' : '✓'} ${o.file.padEnd(34)} ${String(o.ms).padStart(5)} ms  ${o.verdict}`,
    );
    for (const p of o.problems) console.log(`      ${p}`);
  }
  const latencies = outcomes.map((o) => o.ms).filter(Number.isFinite);
  const correct = outcomes.filter((o) => o.problems.length === 0).length;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  console.log(
    `  correct ${correct}/${outcomes.length} · p50 ${p50} ms · p95 ${p95} ms · wall ${wallMs} ms`,
  );
  return { correct: correct === outcomes.length, p95 };
}

async function main() {
  const repeatIndex = process.argv.indexOf('--repeat');
  const repeat = repeatIndex > 0 ? Number(process.argv[repeatIndex + 1]) : 1;
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : undefined;
  const selected = EVAL_CASES.filter((c) => !only || c.file.includes(only));
  const cases = Array.from({ length: repeat }, () => selected).flat();
  const reader = createLabelReader(parseEnv(process.env));
  console.log(`Label reader: ${reader.modelId} · ${cases.length} reads`);

  // Warm the connection so the first case is not charged for TLS setup.
  await runCase(reader, EVAL_CASES[0]!).catch(() => undefined);

  const sequential = report('One at a time', await runAll(reader, cases, 1));
  const parallel = report(
    `${CONCURRENCY} at a time (batch)`,
    await runAll(reader, cases, CONCURRENCY),
  );

  const passed =
    sequential.correct &&
    parallel.correct &&
    sequential.p95 <= LATENCY_BUDGET_MS &&
    parallel.p95 <= LATENCY_BUDGET_MS;
  console.log(
    passed
      ? '\nPASS'
      : `\nFAIL (all conclusions must be correct and p95 ≤ ${LATENCY_BUDGET_MS} ms)`,
  );
  process.exit(passed ? 0 : 1);
}

void main();

import { compareExpected, type Comparison } from './compare-expected';
import { applyCorrections, type Corrections } from './corrections';
import { type LabelImage, type LabelReader } from './label-reader';
import { type ExpectedValues, type LabelReading } from './reading';
import { runLabelRules } from './rules';
import { type RuleOutcome } from './rules/types';
import { decideVerdict, type Verdict } from './verdict';

/** What the reviewer has added on top of the AI reading. */
export interface ReviewerInput {
  expected?: ExpectedValues;
  corrections?: Corrections;
}

export interface LabelReport {
  verdict: Verdict;
  rules: RuleOutcome[];
  comparisons: Comparison[];
  /** The reader's original output, never modified. */
  reading: LabelReading;
  /** The reading with corrections applied — what the rules judged. */
  effectiveReading: LabelReading;
  expected: ExpectedValues;
  corrections: Corrections;
}

/**
 * Everything that follows a reading is deterministic and instant, so it is
 * reused as-is when a reviewer edits values.
 */
export function assessReading(
  reading: LabelReading,
  { expected = {}, corrections = {} }: ReviewerInput = {},
): LabelReport {
  const effectiveReading = applyCorrections(reading, corrections);
  const rules = runLabelRules(effectiveReading);
  const comparisons = compareExpected(expected, effectiveReading);
  return {
    verdict: decideVerdict(rules, comparisons, effectiveReading.imageQuality),
    rules,
    comparisons,
    reading,
    effectiveReading,
    expected,
    corrections,
  };
}

/** Read one label image and assess it. The reader is the only I/O. */
export async function verifyLabel(
  image: LabelImage,
  deps: { reader: LabelReader } & ReviewerInput,
): Promise<LabelReport> {
  const reading = await deps.reader.read(image);
  return assessReading(reading, deps);
}

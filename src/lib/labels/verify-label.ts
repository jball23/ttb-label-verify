import { compareExpected, type Comparison } from './compare-expected';
import { type LabelImage, type LabelReader } from './label-reader';
import { type ExpectedValues, type LabelReading } from './reading';
import { runLabelRules } from './rules';
import { type RuleOutcome } from './rules/types';
import { decideVerdict, type Verdict } from './verdict';

export interface LabelReport {
  verdict: Verdict;
  rules: RuleOutcome[];
  comparisons: Comparison[];
  reading: LabelReading;
  expected: ExpectedValues;
}

/**
 * Everything that follows a reading is deterministic and instant, so it is
 * reused as-is when a reviewer edits the expected values.
 */
export function assessReading(reading: LabelReading, expected: ExpectedValues = {}): LabelReport {
  const rules = runLabelRules(reading);
  const comparisons = compareExpected(expected, reading);
  return {
    verdict: decideVerdict(rules, comparisons, reading.imageQuality),
    rules,
    comparisons,
    reading,
    expected,
  };
}

/** Read one label image and assess it. The reader is the only I/O. */
export async function verifyLabel(
  image: LabelImage,
  deps: { reader: LabelReader; expected?: ExpectedValues },
): Promise<LabelReport> {
  const reading = await deps.reader.read(image);
  return assessReading(reading, deps.expected);
}

import { compareExpected, type Comparison } from './compare-expected';
import { warningIsExact, warningNeedsSecondRead } from './government-warning';
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

/**
 * Read one label. If the warning looks wrong, read just the warning again
 * and accept it only when that focused read is the exact legal text — so a
 * misread of small type does not fail a compliant label, while a label that
 * really is wrong still fails.
 */
export async function readLabel(reader: LabelReader, image: LabelImage): Promise<LabelReading> {
  const reading = await reader.read(image);
  if (!warningNeedsSecondRead(reading.governmentWarning.verbatimText)) return reading;
  const second = await reader.readWarning(image);
  if (!warningIsExact(second)) return reading;
  return { ...reading, governmentWarning: { ...reading.governmentWarning, verbatimText: second } };
}

/** Read one label image and assess it. The reader is the only I/O. */
export async function verifyLabel(
  image: LabelImage,
  deps: { reader: LabelReader } & ReviewerInput,
): Promise<LabelReport> {
  return assessReading(await readLabel(deps.reader, image), deps);
}

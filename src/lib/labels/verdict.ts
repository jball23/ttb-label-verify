import { type Comparison } from './compare-expected';
import { type LabelReading } from './reading';
import { type RuleOutcome } from './rules/types';

/** The tool's suggestion. A person always makes the final decision. */
export type Verdict = 'looks_good' | 'needs_review' | 'problems_found';

export const VERDICT_LABELS: Record<Verdict, string> = {
  looks_good: 'Looks good',
  needs_review: 'Needs a look',
  problems_found: 'Problem found',
};

export function decideVerdict(
  rules: readonly RuleOutcome[],
  comparisons: readonly Comparison[],
  imageQuality: LabelReading['imageQuality'],
): Verdict {
  // An unreadable image cannot support either verdict.
  if (!imageQuality.legible) return 'needs_review';
  if (rules.some((r) => r.status === 'fail')) return 'problems_found';
  const comparisonNeedsLook = comparisons.some(
    (c) => c.status === 'differs' || c.status === 'not_found_on_label',
  );
  if (comparisonNeedsLook || rules.some((r) => r.status === 'review')) return 'needs_review';
  return 'looks_good';
}

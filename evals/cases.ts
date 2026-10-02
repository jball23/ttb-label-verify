import { type ComparisonStatus } from '@/lib/labels/compare-expected';
import { type ExpectedValues, type LabelFieldId } from '@/lib/labels/reading';
import { type RuleStatus } from '@/lib/labels/rules/types';
import { type Verdict } from '@/lib/labels/verdict';

/**
 * Known labels and what a correct check concludes about each. Images live in
 * public/samples/labels (the AI-generated ones from the original build, plus
 * labels rendered from samples/labels/label.html with one deliberate flaw each).
 */
export interface EvalCase {
  file: string;
  /** Any of these verdicts is correct. */
  verdicts: Verdict[];
  /** Rule outcomes that must hold, by rule id. */
  rules?: Partial<Record<string, RuleStatus>>;
  /** Application values to compare, and the comparison results that must hold. */
  expected?: ExpectedValues;
  comparisons?: Partial<Record<LabelFieldId, ComparisonStatus>>;
  why: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    file: 'old-tom-bourbon.jpg',
    verdicts: ['looks_good'],
    expected: {
      brandName: 'Old Tom Distillery',
      alcoholContent: '45%',
      netContents: '750 mL',
    },
    comparisons: { brandName: 'match', alcoholContent: 'match', netContents: 'match' },
    why: "The brief's own sample label, fully compliant.",
  },
  {
    file: 'old-tom-title-case-warning.jpg',
    verdicts: ['problems_found'],
    rules: { governmentWarning: 'fail' },
    why: 'Jenny: "Government Warning" in title case is rejected. The reader must not correct it.',
  },
  {
    file: 'old-tom-reworded-warning.jpg',
    verdicts: ['problems_found'],
    rules: { governmentWarning: 'fail' },
    why: 'One added word ("serious") in the warning. Tests the transcribe-do-not-correct instruction.',
  },
  {
    file: 'old-tom-glare-angle.jpg',
    verdicts: ['looks_good', 'needs_review'],
    why: 'Jenny: photos at an angle with glare. Must read it or ask for a better photo, never invent a problem.',
  },
  {
    file: 'stones-throw-gin.jpg',
    verdicts: ['looks_good'],
    expected: { brandName: "Stone's Throw" },
    comparisons: { brandName: 'match' },
    why: 'Dave: "STONE\'S THROW" on the label vs "Stone\'s Throw" in the application is the same brand.',
  },
  {
    file: 'ridge-creek-bourbon.jpg',
    verdicts: ['looks_good'],
    why: 'AI-generated compliant bourbon label.',
  },
  {
    file: 'silver-birch-vodka.jpg',
    verdicts: ['looks_good'],
    why: 'AI-generated compliant vodka label.',
  },
  {
    file: 'hawthorne-cabernet.jpg',
    verdicts: ['looks_good'],
    why: 'AI-generated compliant wine label.',
  },
  {
    file: 'ironwood-ipa-no-warning.jpg',
    verdicts: ['problems_found'],
    rules: { governmentWarning: 'fail' },
    why: 'AI-generated beer label with the warning deliberately left off.',
  },
  {
    file: 'calypso-rum-proof-only.jpg',
    verdicts: ['needs_review'],
    rules: { alcoholContent: 'review' },
    why: 'Alcohol shown only as "80 PROOF"; spirits must state a percentage.',
  },
];

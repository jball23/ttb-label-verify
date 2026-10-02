import { type LabelReading } from '../reading';

/**
 * pass   — meets the requirement.
 * review — a person should look (unsure reading, or a judgment call).
 * fail   — does not meet the requirement.
 */
export type RuleStatus = 'pass' | 'review' | 'fail';

export interface RuleCheck {
  status: RuleStatus;
  /** One plain-language sentence a reviewer can act on. */
  reason: string;
  /** What the label says, for display. */
  value: string | null;
}

/** Requirement text and citations live in ../requirements.ts, keyed by the same id. */
export interface LabelRule {
  id: string;
  label: string;
  check(reading: LabelReading): RuleCheck;
}

export interface RuleOutcome extends RuleCheck {
  id: string;
  label: string;
}

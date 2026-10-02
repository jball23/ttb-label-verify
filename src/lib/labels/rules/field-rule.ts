import { LABEL_FIELD_LABELS, type LabelFieldId } from '../reading';
import { type LabelRule, type RuleStatus } from './types';

interface FieldRuleSpec {
  field: LabelFieldId;
  /** Status when the field is absent. Some statements have exemptions. */
  whenMissing: Exclude<RuleStatus, 'pass'>;
  missingReason: string;
  /** Returns a problem description, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

/**
 * The shared shape of every "this statement must appear on the label" rule:
 * missing → `whenMissing`; unsure reading → review; badly formed → review;
 * otherwise pass.
 */
export function fieldRule(spec: FieldRuleSpec): LabelRule {
  const label = LABEL_FIELD_LABELS[spec.field];
  return {
    id: spec.field,
    label,
    check(reading) {
      const { value, confidence } = reading.fields[spec.field];
      if (!value?.trim()) {
        return { status: spec.whenMissing, reason: spec.missingReason, value: null };
      }
      if (confidence === 'low') {
        return {
          status: 'review',
          reason: `${label} was hard to read on this image. Check it against the label.`,
          value,
        };
      }
      const problem = spec.validate?.(value) ?? null;
      if (problem) return { status: 'review', reason: problem, value };
      return { status: 'pass', reason: `${label} is on the label.`, value };
    },
  };
}

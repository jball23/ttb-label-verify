import { type Comparison } from './compare-expected';
import {
  CORRECTABLE_FIELDS,
  isConfirmation,
  originalValue,
  type CorrectableField,
  type Correction,
} from './corrections';
import { LABEL_FIELD_LABELS } from './reading';
import { inferOrigin } from './origin';
import { REQUIREMENTS, type Requirement } from './requirements';
import { type RuleStatus } from './rules/types';
import { type LabelReport } from './verify-label';

/** `not_checked`: nothing is required of this item on every label (country of origin with no application value). */
export type ChecklistStatus = RuleStatus | 'not_checked';

/** One line of the review: everything known about one item on the label. */
export interface ChecklistItem {
  field: CorrectableField;
  label: string;
  status: ChecklistStatus;
  /** Why it needs attention; null when it passes. */
  reason: string | null;
  /** What the checks used: the reading, the reviewer's correction, or what was inferred. */
  value: string | null;
  /** How a value not printed as such was worked out, e.g. from the bottler's address. */
  valueNote: string | null;
  /** The text to outline on the photo for this item. */
  locate: string | null;
  /** What the model read, before any correction. */
  readValue: string | null;
  lowConfidence: boolean;
  correction: Correction | null;
  /** A confirmation keeps the read value; a change replaces it. */
  correctionKind: 'changed' | 'confirmed' | null;
  /** Null for the warning, which has no application value. */
  comparison: Comparison | null;
  requirement: Requirement;
}

const STATUS_RANK: Record<ChecklistStatus, number> = {
  fail: 0,
  review: 1,
  pass: 2,
  not_checked: 3,
};

/**
 * Joins each field's rule outcome, application comparison and correction
 * into one item, worst first (stable within a status).
 */
export function buildChecklist(report: LabelReport): ChecklistItem[] {
  const items = CORRECTABLE_FIELDS.map((field): ChecklistItem => {
    const rule = report.rules.find((r) => r.id === field) ?? null;
    const comparison = report.comparisons.find((c) => c.field === field) ?? null;
    const comparisonProblem = describeComparison(comparison);
    const ruleStatus: ChecklistStatus =
      rule?.status ?? (comparison?.status === 'match' ? 'pass' : 'not_checked');
    const status =
      comparisonProblem && STATUS_RANK[ruleStatus] > STATUS_RANK.review
        ? 'review'
        : ruleStatus;
    const ruleProblem = rule && rule.status !== 'pass' ? rule.reason : null;
    return {
      field,
      label:
        field === 'governmentWarning' ? 'Government warning' : LABEL_FIELD_LABELS[field],
      status,
      reason: [ruleProblem, comparisonProblem].filter(Boolean).join(' ') || null,
      ...shownValue(report, field),
      readValue: originalValue(report.reading, field),
      lowConfidence:
        field !== 'governmentWarning' &&
        report.reading.fields[field].confidence === 'low',
      correction: report.corrections[field] ?? null,
      correctionKind: correctionKind(report, field),
      comparison,
      requirement: REQUIREMENTS[field],
    };
  });
  return items
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.item.status] - STATUS_RANK[b.item.status] || a.order - b.order,
    )
    .map(({ item }) => item);
}

/** The value to show and outline; country of origin may be inferred from the address. */
function shownValue(
  report: LabelReport,
  field: CorrectableField,
): Pick<ChecklistItem, 'value' | 'valueNote' | 'locate'> {
  const printed = originalValue(report.effectiveReading, field);
  if (field === 'countryOfOrigin' && !printed) {
    const origin = inferOrigin(report.effectiveReading);
    if (origin.how === 'address') {
      return {
        value: origin.country,
        valueNote: `From the bottler's address: ${origin.place}`,
        locate: origin.place,
      };
    }
  }
  return { value: printed, valueNote: null, locate: printed };
}

function correctionKind(
  report: LabelReport,
  field: CorrectableField,
): ChecklistItem['correctionKind'] {
  const correction = report.corrections[field];
  if (!correction) return null;
  return isConfirmation(report.reading, field, correction) ? 'confirmed' : 'changed';
}

function describeComparison(comparison: Comparison | null): string | null {
  if (comparison?.status === 'differs')
    return `Differs from the application ("${comparison.expected}").`;
  if (comparison?.status === 'not_found_on_label')
    return `The application says "${comparison.expected}", which is not on the label.`;
  return null;
}

import { type LabelReport } from './verify-label';
import { type Verdict } from './verdict';

/** Worst first, so a reviewer sees problems before anything else. */
const VERDICT_RANK: Record<Verdict, number> = {
  problems_found: 0,
  needs_review: 1,
  looks_good: 2,
};

type Sortable = { createdAt: string; report: { verdict: Verdict } };

export function byProblemsFirst(a: Sortable, b: Sortable): number {
  return VERDICT_RANK[a.report.verdict] - VERDICT_RANK[b.report.verdict] || a.createdAt.localeCompare(b.createdAt);
}

/** The one sentence a list row shows: the most important thing to know. */
export function summarizeReport(report: LabelReport): string {
  const { rules, comparisons, effectiveReading } = report;
  if (!effectiveReading.imageQuality.legible) {
    const issue = effectiveReading.imageQuality.issues[0];
    return `${issue ? capitalize(issue) + '. ' : ''}Ask for a better photo.`;
  }
  const fail = rules.find((r) => r.status === 'fail');
  if (fail) return fail.reason;
  const differs = comparisons.find((c) => c.status === 'differs');
  if (differs) return `${differs.label} differs from the application.`;
  const missing = comparisons.find((c) => c.status === 'not_found_on_label');
  if (missing) return `${missing.label} from the application is not on the label.`;
  const review = rules.find((r) => r.status === 'review');
  if (review) return review.reason;
  return 'Everything required is on the label.';
}

/** A short display name: the brand if one was read, else the file name. */
export function labelTitle(report: LabelReport, filename: string): string {
  return report.effectiveReading.fields.brandName.value?.trim() || filename;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, '');
}

import { type ResultLine } from './result-types';

export interface StatusCounts {
  compliant: number;
  needsReview: number;
  error: number;
}

export function countByStatus(results: ResultLine[]): StatusCounts {
  let compliant = 0;
  let needsReview = 0;
  let error = 0;
  for (const r of results) {
    if (r.status === 'error') error += 1;
    else if (r.report.overallStatus === 'compliant') compliant += 1;
    else needsReview += 1;
  }
  return { compliant, needsReview, error };
}

/**
 * What to announce in the ARIA live region. Empty string when nothing's
 * happened yet (don't bother screen readers with vacuous updates).
 */
export function liveRegionMessage(received: number, total: number): string {
  if (received === 0 || total === 0) return '';
  if (received >= total) return `All ${total} labels checked.`;
  return `${received} of ${total} labels checked.`;
}

export function isBatchComplete(received: number, total: number): boolean {
  return total > 0 && received >= total;
}

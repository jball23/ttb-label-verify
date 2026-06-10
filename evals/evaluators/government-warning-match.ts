import { type ExtractedFields } from '../../src/lib/extraction/types';

export interface WarningMatchResult {
  score: 0 | 1;
  reason?: string;
}

function normalize(value: string | null): string | null {
  if (value === null) return null;
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Binary exact-match scorer for the Government Warning text.
 *
 * Both expected and actual are normalized for whitespace before comparison.
 * Case IS significant — "GOVERNMENT WARNING:" is required to be in all caps.
 *
 * Note: the rule engine's `government-warning` rule produces a richer reason on
 * mismatch (which part drifted). This evaluator uses simple equality because
 * we're scoring extraction correctness, not regulatory compliance — that's the
 * rule engine's job.
 */
export function governmentWarningMatch(
  expected: ExtractedFields,
  actual: ExtractedFields,
): WarningMatchResult {
  const e = normalize(expected.governmentWarning.text);
  const a = normalize(actual.governmentWarning.text);

  if (e === null && a === null) {
    return { score: 1 };
  }
  if (e === null && a !== null) {
    return {
      score: 0,
      reason: 'Hallucinated warning — expected null, got extracted text.',
    };
  }
  if (e !== null && a === null) {
    return { score: 0, reason: 'Missed warning — expected text, got null.' };
  }
  if (e === a) {
    return { score: 1 };
  }
  return {
    score: 0,
    reason: 'Warning text differs from expected (see trace for diff).',
  };
}

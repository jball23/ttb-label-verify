import { type ExtractedFields } from '../../src/lib/extraction/types';

export interface FieldScore {
  field: string;
  score: number;
  expected: string | null;
  actual: string | null;
}

export interface FieldAccuracyResult {
  perField: FieldScore[];
  aggregate: number | null;
}

const STRING_FIELDS: Array<keyof ExtractedFields> = [
  'brandName',
  'abv',
  'netContents',
  'classType',
  'producer',
  'countryOfOrigin',
];

function normalize(value: string | null): string | null {
  if (value === null) return null;
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function scoreField(expected: string | null, actual: string | null): number {
  const e = normalize(expected);
  const a = normalize(actual);
  if (e === null && a === null) return 1;
  if (e === null && a !== null) return 0; // hallucination
  if (e !== null && a === null) return 0; // missed
  return e === a ? 1 : 0;
}

/**
 * Per-field precision scorer. Does NOT score the Government Warning text — that's
 * the dedicated `government-warning-match` evaluator's job.
 *
 * For each string field in `expected`, compare to `actual` after whitespace + case
 * normalization. Returns per-field 0/1 scores and an aggregate mean.
 *
 * Aggregate is `null` when `expected` has no fields to score (vacuous).
 */
export function fieldExtractionAccuracy(
  expected: ExtractedFields,
  actual: ExtractedFields,
): FieldAccuracyResult {
  const perField: FieldScore[] = STRING_FIELDS.map((field) => {
    const e = expected[field] as string | null;
    const a = actual[field] as string | null;
    return {
      field,
      score: scoreField(e, a),
      expected: e,
      actual: a,
    };
  });

  if (perField.length === 0) {
    return { perField, aggregate: null };
  }

  const sum = perField.reduce((acc, f) => acc + f.score, 0);
  return { perField, aggregate: sum / perField.length };
}

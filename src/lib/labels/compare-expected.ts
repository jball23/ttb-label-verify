import {
  classTypeMatches,
  countryMatches,
  normalizedExact,
  producerMatches,
} from './normalize';
import { amountsAgree, parseAlcoholPercent, parseVolumeMl } from './measures';
import {
  LABEL_FIELD_IDS,
  LABEL_FIELD_LABELS,
  type ExpectedValues,
  type LabelFieldId,
  type LabelReading,
} from './reading';

/**
 * match              — the label agrees with the application.
 * differs            — they disagree; a person decides (never an auto-reject).
 * not_found_on_label — the application has a value the label does not show.
 * not_entered        — the reviewer has not entered an application value.
 */
export type ComparisonStatus = 'match' | 'differs' | 'not_found_on_label' | 'not_entered';

export interface Comparison {
  field: LabelFieldId;
  label: string;
  status: ComparisonStatus;
  expected: string | null;
  found: string | null;
}

type Matcher = (expected: string, found: string) => boolean;

/** Same amount, whatever the wording: "45%" = "45% Alc./Vol. (90 Proof)". */
const sameAmount =
  (parse: (text: string) => number | null): Matcher =>
  (expected, found) => {
    const a = parse(expected);
    const b = parse(found);
    return a !== null && b !== null && amountsAgree(a, b);
  };

/** Case, punctuation and quote-style insensitive: "STONE'S THROW" = "Stone’s Throw". */
const sameWords: Matcher = (expected, found) => looseText(expected) === looseText(found);

function looseText(value: string): string {
  return normalizedExact(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** One matcher per field. Adding a field means adding one entry. */
const MATCHERS: Record<LabelFieldId, Matcher> = {
  brandName: sameWords,
  classType: (expected, found) =>
    sameWords(expected, found) || classTypeMatches(expected, found),
  alcoholContent: sameAmount(parseAlcoholPercent),
  netContents: sameAmount(parseVolumeMl),
  producer: producerMatches,
  countryOfOrigin: countryMatches,
};

export function compareExpected(
  expected: ExpectedValues,
  reading: LabelReading,
): Comparison[] {
  return LABEL_FIELD_IDS.map((field) => {
    const want = expected[field]?.trim() || null;
    const found = reading.fields[field].value?.trim() || null;
    return {
      field,
      label: LABEL_FIELD_LABELS[field],
      expected: want,
      found,
      status: compareOne(field, want, found),
    };
  });
}

function compareOne(
  field: LabelFieldId,
  want: string | null,
  found: string | null,
): ComparisonStatus {
  if (!want) return 'not_entered';
  if (!found) return 'not_found_on_label';
  return MATCHERS[field](want, found) ? 'match' : 'differs';
}

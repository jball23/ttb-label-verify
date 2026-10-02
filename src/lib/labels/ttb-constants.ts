/**
 * Canonical TTB regulatory text and patterns.
 *
 * Source: 27 CFR §16.21 — verified character-for-character against the
 * legal text on 2026-06-09 (law.cornell.edu/cfr/text/27/16.21).
 *
 * DO NOT MODIFY without re-verifying against the source — every label
 * check depends on this being exact.
 */

export const GOVERNMENT_WARNING_CANONICAL =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

export const GOVERNMENT_WARNING_PREFIX = 'GOVERNMENT WARNING:';

export const GOVERNMENT_WARNING_SENTENCE_1 =
  '(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.';

export const GOVERNMENT_WARNING_SENTENCE_2 =
  '(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

import { type Rule } from '../types';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_SENTENCE_1,
  GOVERNMENT_WARNING_SENTENCE_2,
  normalizeWhitespace,
} from '../ttb-constants';

const NORMALIZED_CANONICAL = normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL);

const governmentWarningRule: Rule = {
  id: 'governmentWarning',
  label: 'Government warning',
  cfr: {
    section: '27 CFR §16.21–§16.22',
    summary:
      'The Health Warning Statement is required on the label of every alcoholic beverage container bottled on or after November 18, 1989. It must be readable, conspicuous, separated from other text, and meet minimum type-size requirements.',
    quote:
      '"GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems." — must appear in capital letters and bold print, on a contrasting background, at minimum 1 mm type for containers ≤237 mL and 2 mm for >237 mL.',
  },
  check(extracted) {
    const { text, appearsBold, appearsAllCaps } = extracted.governmentWarning;

    if (!text || text.trim().length === 0) {
      return {
        status: 'fail',
        reason: 'Government Warning not detected on the label.',
        extractedValue: null,
      };
    }

    const normalized = normalizeWhitespace(text);
    // §16.21 actually REQUIRES the warning to "appear in capital letters" on
    // the label, and most real TTB-approved labels print the whole statement
    // in ALL CAPS. Compare case-insensitively against the canonical so the
    // model's all-caps extraction (matching the printed label) doesn't trip
    // a false mismatch. We retain canonical case in the constants so error
    // messages still read naturally.
    const normalizedLower = normalized.toLowerCase();
    const canonicalLower = NORMALIZED_CANONICAL.toLowerCase();
    const prefixLower = GOVERNMENT_WARNING_PREFIX.toLowerCase();
    const s1Lower = GOVERNMENT_WARNING_SENTENCE_1.toLowerCase();
    const s2Lower = GOVERNMENT_WARNING_SENTENCE_2.toLowerCase();

    if (normalizedLower !== canonicalLower) {
      // Identify the most specific drift cause we can surface.
      if (!normalizedLower.includes(prefixLower)) {
        return {
          status: 'fail',
          reason: `The "${GOVERNMENT_WARNING_PREFIX}" prefix is missing from the warning text.`,
          extractedValue: text,
        };
      }
      const hasS1 = normalizedLower.includes(s1Lower);
      const hasS2 = normalizedLower.includes(s2Lower);
      if (!hasS1 && hasS2) {
        return {
          status: 'fail',
          reason:
            'The Government Warning is missing the first sentence about the Surgeon General and pregnancy.',
          extractedValue: text,
        };
      }
      if (hasS1 && !hasS2) {
        return {
          status: 'fail',
          reason:
            'The Government Warning is missing the second sentence about driving and machinery.',
          extractedValue: text,
        };
      }
      if (!hasS1 && !hasS2) {
        return {
          status: 'fail',
          reason:
            'The Government Warning text differs substantially from the required wording.',
          extractedValue: text,
        };
      }
      return {
        status: 'fail',
        reason:
          'The Government Warning text differs from the required wording (see details).',
        extractedValue: text,
      };
    }

    // Text matches. Surface visual-styling concerns as uncertain, not fail —
    // vision LLMs are weak at typography and we don't want false positives.
    if (appearsBold === false) {
      return {
        status: 'uncertain',
        reason:
          'The Government Warning text is correct, but may not appear in bold as required.',
        extractedValue: text,
      };
    }
    if (appearsAllCaps === false) {
      return {
        status: 'uncertain',
        reason:
          'The Government Warning text is correct, but the "GOVERNMENT WARNING:" prefix may not be in all caps as required.',
        extractedValue: text,
      };
    }

    return { status: 'pass', extractedValue: text };
  },
};

export default governmentWarningRule;

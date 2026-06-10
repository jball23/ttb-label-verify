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

    if (normalized !== NORMALIZED_CANONICAL) {
      // Identify the most specific drift cause we can surface.
      if (!normalized.includes(GOVERNMENT_WARNING_PREFIX)) {
        return {
          status: 'fail',
          reason: `The "${GOVERNMENT_WARNING_PREFIX}" prefix is missing from the warning text.`,
          extractedValue: text,
        };
      }
      const hasS1 = normalized.includes(GOVERNMENT_WARNING_SENTENCE_1);
      const hasS2 = normalized.includes(GOVERNMENT_WARNING_SENTENCE_2);
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

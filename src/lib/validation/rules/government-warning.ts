import { type Rule } from '../types';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  normalizeWhitespace,
} from '../ttb-constants';

const NORMALIZED_CANONICAL = normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL);

// Anchor-word sentence match: each sentence has 10 content anchors that
// uniquely identify it. Need 85%+ of anchors present (9/10) to pass. This
// trades off two failure modes:
//   - Tesseract reliably drops 1-2-char connector words ("to", "of", "a")
//     on dense/curved GW print — Vina La Rosa's front-label GW loses 5+
//     such tokens. Exact-substring fails; anchors don't include short
//     connectors so they're unaffected.
//   - Substantive rewording must still fail. Anchors include the load-
//     bearing verbs ("should", "drink", "impairs", "drive"), so
//     "might want to consider not drinking" loses both "should" and
//     "drink" (only "drinking" present, Set lookup is exact) → 8/10 → fail.
const SENTENCE_ANCHOR_THRESHOLD = 0.85;

const SENTENCE_1_ANCHORS = [
  'according',
  'surgeon',
  'general',
  'women',
  'should',
  'drink',
  'alcoholic',
  'pregnancy',
  'birth',
  'defects',
] as const;

const SENTENCE_2_ANCHORS = [
  'consumption',
  'alcoholic',
  'beverages',
  'impairs',
  'ability',
  'drive',
  'operate',
  'machinery',
  'health',
  'problems',
] as const;

function contentTokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function hasAnchorCoverage(extracted: string, anchors: ReadonlyArray<string>): boolean {
  const extSet = contentTokenSet(extracted);
  const matched = anchors.filter((a) => extSet.has(a)).length;
  return matched / anchors.length >= SENTENCE_ANCHOR_THRESHOLD;
}

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
    const normalizedLower = normalized.toLowerCase();
    const canonicalLower = NORMALIZED_CANONICAL.toLowerCase();
    const prefixLower = GOVERNMENT_WARNING_PREFIX.toLowerCase();

    if (normalizedLower !== canonicalLower) {
      // Prefix is non-negotiable — without "GOVERNMENT WARNING:" there is no
      // warning, regardless of what other text follows.
      if (!normalizedLower.includes(prefixLower)) {
        return {
          status: 'fail',
          reason: `The "${GOVERNMENT_WARNING_PREFIX}" prefix is missing from the warning text.`,
          extractedValue: text,
        };
      }
      const hasS1 = hasAnchorCoverage(normalized, SENTENCE_1_ANCHORS);
      const hasS2 = hasAnchorCoverage(normalized, SENTENCE_2_ANCHORS);
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
      // Both sentences cleared the fuzzy threshold — accept as PASS even if
      // the exact-match comparison above said no. Connector-word OCR drift
      // is the dominant cause and doesn't indicate a real compliance gap.
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

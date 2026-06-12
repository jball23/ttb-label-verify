import { type Rule } from '../types';

// Accepted TTB-compliant ABV shapes — match a percentage number plus any
// of the canonical descriptors. TTB approves a wide range of real-world
// phrasings:
//   "40% ALC/VOL"             — the canonical form per §5.65
//   "40% Alc. Vol."           — punctuated/cased variant
//   "40 % ALC/VOL"            — space before %
//   "40% Alcohol by Volume"   — long form
//   "40% ABV"                 — abbreviation
//   "8.0%"                    — beer/wine bare-percent shorthand
//   "40% Alc. Vol. (80 proof)" — spirits with proof in parens (TTB approved)
//   "(80 PROOF)" alone        — uppercase proof shorthand
// The check is lenient by design — see Tequila el-mayoral-de-la-hacienda
// (TTB id 26089001000771) which carries "40% Alc. Vol. (80 proof)" and
// was approved.
const PERCENT_RE = /\b\d{1,2}(\.\d{1,2})?\s*%/;
const PROOF_RE = /\bproof\b/i;
// Some TTB applications include just the bare percent number (no % sign).
// Accept e.g. "40" or "8.5" as a fallback when the whole value is numeric.
const BARE_NUMERIC_RE = /^\d{1,2}(\.\d{1,2})?$/;

const abvRule: Rule = {
  id: 'abv',
  label: 'Alcohol by volume (ABV)',
  cfr: {
    section: '27 CFR §4.36 (wine) / §5.65 (spirits) / §7.65 (malt beverages)',
    summary:
      'The label must state the alcohol content as a percentage of alcohol by volume in a specified format. Distilled spirits may also show proof.',
    quote:
      'Alcohol content shall be expressed in the form "__% alcohol by volume" (or "__% alc/vol"). Tolerance is ±1.5% for spirits and ±0.3% for beer.',
  },
  check(extracted) {
    const value = extracted.abv;
    if (!value) {
      return {
        status: 'warn',
        reason: 'Alcohol content (ABV) not detected on the label.',
        extractedValue: null,
      };
    }
    const trimmed = value.trim();
    // Pass if the label has a percent value, a proof statement, or just a
    // bare percent number — TTB accepts any of these.
    if (
      PERCENT_RE.test(trimmed) ||
      PROOF_RE.test(trimmed) ||
      BARE_NUMERIC_RE.test(trimmed)
    ) {
      return { status: 'pass', extractedValue: value };
    }
    return {
      status: 'warn',
      reason:
        'Alcohol content is present but not in a recognized format (expected a percentage or proof value).',
      extractedValue: value,
    };
  },
};

export default abvRule;

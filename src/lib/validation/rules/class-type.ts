import { type Rule } from '../types';

const classTypeRule: Rule = {
  id: 'classType',
  label: 'Fanciful name',
  cfr: {
    section: '27 CFR §4.34 (wine) / §5.35 (spirits) / §7.24 (malt beverages)',
    summary:
      'The label must show the class and/or type designation conforming to the Standards of Identity (Parts 4, 5, 7). This is what the product actually IS in regulatory terms (e.g. "Straight Bourbon Whiskey", "Cabernet Sauvignon", "Ale").',
    quote:
      'The class and type designation appears on the brand label and must conform to the Standards of Identity for the product. Misleading or generic designations are prohibited.',
  },
  check(extracted) {
    const value = extracted.classType;
    if (!value || value.trim().length === 0) {
      return {
        status: 'fail',
        reason: 'Fanciful name not detected on the label.',
        extractedValue: value ?? null,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default classTypeRule;

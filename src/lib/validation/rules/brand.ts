import { type Rule } from '../types';

const brandRule: Rule = {
  id: 'brand',
  label: 'Brand name',
  cfr: {
    section: '27 CFR §4.33 (wine) / §5.63 (spirits) / §7.51 (malt beverages)',
    summary:
      'A brand name must appear on the label. For wine, distilled spirits, and malt beverages, the brand label is required to identify the product by a brand name.',
    quote:
      'The brand label must include a brand name. If the product is not sold under a brand name, the name of the bottler, packer, or importer is treated as the brand name.',
  },
  check(extracted) {
    const value = extracted.brandName;
    if (!value || value.trim().length === 0) {
      return {
        status: 'warn',
        reason: 'Brand name not detected on the label.',
        extractedValue: value ?? null,
      };
    }
    if (extracted.extractionConfidence === 'low') {
      return {
        status: 'uncertain',
        reason:
          'Brand name extracted, but the image quality made the reading unreliable.',
        extractedValue: value,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default brandRule;

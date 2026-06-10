import { type Rule } from '../types';

const brandRule: Rule = {
  id: 'brand',
  label: 'Brand name',
  check(extracted) {
    const value = extracted.brandName;
    if (!value || value.trim().length === 0) {
      return {
        status: 'fail',
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

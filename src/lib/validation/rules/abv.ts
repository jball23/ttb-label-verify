import { type Rule } from '../types';
import { ABV_PATTERN } from '../ttb-constants';

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
        status: 'fail',
        reason: 'Alcohol content (ABV) not detected on the label.',
        extractedValue: null,
      };
    }
    const trimmed = value.trim();
    if (!ABV_PATTERN.test(trimmed)) {
      return {
        status: 'fail',
        reason:
          'Alcohol content is present but not in a recognized format (e.g. "40% ALC/VOL").',
        extractedValue: value,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default abvRule;

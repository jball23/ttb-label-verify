import { type Rule } from '../types';
import { ABV_PATTERN } from '../ttb-constants';

const abvRule: Rule = {
  id: 'abv',
  label: 'Alcohol by volume (ABV)',
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

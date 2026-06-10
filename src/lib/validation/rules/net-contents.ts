import { type Rule } from '../types';
import { NET_CONTENTS_PATTERN } from '../ttb-constants';

const netContentsRule: Rule = {
  id: 'netContents',
  label: 'Net contents',
  check(extracted) {
    const value = extracted.netContents;
    if (!value) {
      return {
        status: 'fail',
        reason: 'Net contents not detected on the label.',
        extractedValue: null,
      };
    }
    const trimmed = value.trim();
    if (!NET_CONTENTS_PATTERN.test(trimmed)) {
      return {
        status: 'fail',
        reason:
          'Net contents is present but the unit is not in a recognized format (mL, L, or fl oz).',
        extractedValue: value,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default netContentsRule;

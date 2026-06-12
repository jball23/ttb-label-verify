import { type Rule } from '../types';
import { NET_CONTENTS_PATTERN } from '../ttb-constants';

const netContentsRule: Rule = {
  id: 'netContents',
  label: 'Net contents',
  cfr: {
    section: '27 CFR §4.37 (wine) / §5.38 (spirits) / §7.27 (malt beverages)',
    summary:
      'The label must state the net contents in metric units (mL or L) for wine and distilled spirits, or in metric and/or U.S. customary units (fl oz) for malt beverages. Standards of fill apply.',
    quote:
      'Net contents shall be stated in milliliters or liters for wine and distilled spirits. Malt beverages may be stated in U.S. measure (e.g. fluid ounces) and/or metric units.',
  },
  check(extracted) {
    const value = extracted.netContents;
    if (!value) {
      return {
        status: 'warn',
        reason: 'Net contents not detected on the label.',
        extractedValue: null,
      };
    }
    const trimmed = value.trim();
    if (!NET_CONTENTS_PATTERN.test(trimmed)) {
      return {
        status: 'warn',
        reason:
          'Net contents is present but the unit is not in a recognized format (mL, L, or fl oz).',
        extractedValue: value,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default netContentsRule;

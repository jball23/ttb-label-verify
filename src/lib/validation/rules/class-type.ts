import { type Rule } from '../types';

const classTypeRule: Rule = {
  id: 'classType',
  label: 'Class/type designation',
  check(extracted) {
    const value = extracted.classType;
    if (!value || value.trim().length === 0) {
      return {
        status: 'fail',
        reason: 'Class/type designation not detected on the label.',
        extractedValue: value ?? null,
      };
    }
    return { status: 'pass', extractedValue: value };
  },
};

export default classTypeRule;

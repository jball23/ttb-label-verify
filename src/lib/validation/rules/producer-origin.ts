import { type Rule } from '../types';

function present(value: string | null): boolean {
  return !!value && value.trim().length > 0;
}

const producerOriginRule: Rule = {
  id: 'producerOrigin',
  label: 'Producer & country of origin',
  check(extracted) {
    const hasProducer = present(extracted.producer);
    const hasCountry = present(extracted.countryOfOrigin);
    const display =
      [extracted.producer, extracted.countryOfOrigin].filter(Boolean).join(' · ') ||
      null;

    if (!hasProducer && !hasCountry) {
      return {
        status: 'fail',
        reason: 'Both producer and country of origin are missing from the label.',
        extractedValue: display,
      };
    }
    if (!hasProducer) {
      return {
        status: 'fail',
        reason: 'Producer information is missing from the label.',
        extractedValue: display,
      };
    }
    if (!hasCountry) {
      return {
        status: 'fail',
        reason: 'Country of origin is missing from the label.',
        extractedValue: display,
      };
    }
    return { status: 'pass', extractedValue: display };
  },
};

export default producerOriginRule;

import { type Rule } from '../types';

function present(value: string | null): boolean {
  return !!value && value.trim().length > 0;
}

const producerOriginRule: Rule = {
  id: 'producerOrigin',
  label: 'Producer & country of origin',
  cfr: {
    section: '27 CFR §4.35 (wine) / §5.36 (spirits) / §7.25 (malt beverages)',
    summary:
      'The label must identify the producer/bottler/importer of record and the place of production. For imported product, country of origin must be declared.',
    quote:
      'The brand label or back label must state the name and address of the bottler (and producer or importer, as applicable). Imported alcoholic beverages must declare "Product of [country]" or equivalent.',
  },
  check(extracted) {
    const hasProducer = present(extracted.producer);
    const hasCountry = present(extracted.countryOfOrigin);
    const display =
      [extracted.producer, extracted.countryOfOrigin].filter(Boolean).join(' · ') ||
      null;

    if (!hasProducer && !hasCountry) {
      return {
        status: 'warn',
        reason: 'Both producer and country of origin are missing from the label.',
        extractedValue: display,
      };
    }
    if (!hasProducer) {
      return {
        status: 'warn',
        reason: 'Producer information is missing from the label.',
        extractedValue: display,
      };
    }
    if (!hasCountry) {
      return {
        status: 'warn',
        reason: 'Country of origin is missing from the label.',
        extractedValue: display,
      };
    }
    return { status: 'pass', extractedValue: display };
  },
};

export default producerOriginRule;

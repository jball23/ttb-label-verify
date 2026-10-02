import { inferOrigin } from '../origin';
import { type LabelRule } from './types';

/**
 * Imports must state their country of origin; domestic products need not.
 * Not applicable when the label gives no way to tell where it was made.
 */
export const countryOfOriginRule: LabelRule = {
  id: 'countryOfOrigin',
  label: 'Country of origin',
  check(reading) {
    const origin = inferOrigin(reading);
    if (origin.how === 'stated') {
      return {
        status: 'pass',
        reason: 'The country of origin is on the label.',
        value: origin.country,
      };
    }
    if (origin.how === 'address') {
      return {
        status: 'pass',
        reason: `Made in the United States (${origin.place}), so no country of origin statement is required.`,
        value: origin.country,
      };
    }
    if (origin.imported) {
      return {
        status: 'review',
        reason:
          'The label names an importer, but no country of origin was found. Imports must state one.',
        value: null,
      };
    }
    return null;
  },
};

import { inferOrigin } from '../origin';
import { type LabelRule } from './types';

/**
 * Imported products must name their US importer ("Imported by" with name
 * and address). Not applicable to domestic labels, or when the label gives
 * no sign of where the product comes from.
 */
export const importerRule: LabelRule = {
  id: 'importer',
  label: 'Importer name and address',
  check(reading) {
    const importer = reading.fields.importer.value?.trim() || null;
    const origin = inferOrigin(reading);
    if (importer) {
      if (reading.fields.importer.confidence === 'low') {
        return {
          status: 'review',
          reason:
            'The importer was hard to read on this image. Check it against the label.',
          value: importer,
        };
      }
      return {
        status: 'pass',
        reason: 'The importer is named on the label.',
        value: importer,
      };
    }
    if (origin.foreign) {
      return {
        status: 'fail',
        reason: `This is an imported product (${origin.country}), but no "Imported by" statement naming the importer was found.`,
        value: null,
      };
    }
    return null;
  },
};

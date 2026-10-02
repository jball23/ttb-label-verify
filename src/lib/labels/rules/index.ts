import { parseAlcoholPercent, parseVolumeMl, statesAlcoholPercent } from '../measures';
import { type LabelReading } from '../reading';
import { fieldRule } from './field-rule';
import { countryOfOriginRule } from './country-of-origin-rule';
import { governmentWarningRule } from './government-warning-rule';
import { importerRule } from './importer-rule';
import { type LabelRule, type RuleOutcome } from './types';

/**
 * Every TTB label requirement checked on an image. To add a requirement,
 * write a LabelRule and register it here — nothing else changes.
 */
export const LABEL_RULES: readonly LabelRule[] = [
  fieldRule({
    field: 'brandName',
    whenMissing: 'fail',
    missingReason: 'No brand name was found on the label.',
  }),
  fieldRule({
    field: 'classType',
    whenMissing: 'fail',
    missingReason:
      'No class/type designation (e.g. "Bourbon Whiskey") was found on the label.',
  }),
  fieldRule({
    field: 'alcoholContent',
    // Some wines and malt beverages are exempt, so a person decides.
    whenMissing: 'review',
    missingReason:
      'No alcohol content was found. That is only allowed for certain wines and beers.',
    validate: (value) => {
      if (statesAlcoholPercent(value)) return null;
      return parseAlcoholPercent(value) === null
        ? 'The alcohol content is not stated as a percentage of alcohol by volume.'
        : 'The alcohol content is shown only as proof. It must also be stated as a percentage of alcohol by volume.';
    },
  }),
  fieldRule({
    field: 'netContents',
    whenMissing: 'fail',
    missingReason: 'No net contents (e.g. "750 mL") was found on the label.',
    validate: (value) =>
      parseVolumeMl(value) === null
        ? 'The net contents does not show a recognizable unit (mL, L or fl oz).'
        : null,
  }),
  fieldRule({
    field: 'producer',
    whenMissing: 'fail',
    missingReason: 'No bottler or producer name and address was found on the label.',
  }),
  importerRule,
  countryOfOriginRule,
  governmentWarningRule,
];

export function runLabelRules(reading: LabelReading): RuleOutcome[] {
  return LABEL_RULES.flatMap((rule) => {
    const check = rule.check(reading);
    return check ? [{ id: rule.id, label: rule.label, ...check }] : [];
  });
}

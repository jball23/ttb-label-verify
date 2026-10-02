import { parseAlcoholPercent, parseVolumeMl, statesAlcoholPercent } from '../measures';
import { type LabelReading } from '../reading';
import { fieldRule } from './field-rule';
import { governmentWarningRule } from './government-warning-rule';
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
    cfr: {
      section: '27 CFR §4.33 / §5.63 / §7.51',
      summary: 'The label must show the brand name the product is sold under.',
    },
  }),
  fieldRule({
    field: 'classType',
    whenMissing: 'fail',
    missingReason: 'No class/type designation (e.g. "Bourbon Whiskey") was found on the label.',
    cfr: {
      section: '27 CFR §4.34 / §5.35 / §7.24',
      summary: 'The label must state the class and type of the product under the Standards of Identity.',
    },
  }),
  fieldRule({
    field: 'alcoholContent',
    // Some wines and malt beverages are exempt, so a person decides.
    whenMissing: 'review',
    missingReason: 'No alcohol content was found. That is only allowed for certain wines and beers.',
    validate: (value) => {
      if (statesAlcoholPercent(value)) return null;
      return parseAlcoholPercent(value) === null
        ? 'The alcohol content is not stated as a percentage of alcohol by volume.'
        : 'The alcohol content is shown only as proof. It must also be stated as a percentage of alcohol by volume.';
    },
    cfr: {
      section: '27 CFR §4.36 / §5.65 / §7.65',
      summary: 'Alcohol content must be stated as a percentage of alcohol by volume; spirits may add proof.',
    },
  }),
  fieldRule({
    field: 'netContents',
    whenMissing: 'fail',
    missingReason: 'No net contents (e.g. "750 mL") was found on the label.',
    validate: (value) =>
      parseVolumeMl(value) === null ? 'The net contents does not show a recognizable unit (mL, L or fl oz).' : null,
    cfr: {
      section: '27 CFR §4.37 / §5.38 / §7.27',
      summary: 'The label must state the net contents, in metric units for wine and spirits.',
    },
  }),
  fieldRule({
    field: 'producer',
    whenMissing: 'fail',
    missingReason: 'No bottler or producer name and address was found on the label.',
    cfr: {
      section: '27 CFR §4.35 / §5.36 / §7.25',
      summary: 'The label must name the bottler, producer or importer and its address.',
    },
  }),
  governmentWarningRule,
];

export function runLabelRules(reading: LabelReading): RuleOutcome[] {
  return LABEL_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    cfr: rule.cfr,
    ...rule.check(reading),
  }));
}

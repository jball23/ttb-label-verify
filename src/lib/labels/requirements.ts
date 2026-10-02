import { type CorrectableField } from './corrections';

export interface Requirement {
  /** Where it is in the regulations, when one section governs it. */
  section: string | null;
  /** What the label must show, in plain language. */
  summary: string;
}

/**
 * What TTB requires for each item on a label. One source for the rules and
 * for the reviewer's "about this requirement" notes.
 */
export const REQUIREMENTS: Record<CorrectableField, Requirement> = {
  brandName: {
    section: '27 CFR §4.33 (wine) · §5.63 (spirits) · §7.51 (malt beverages)',
    summary: 'The label must show the brand name the product is sold under.',
  },
  classType: {
    section: '27 CFR §4.34 · §5.35 · §7.24',
    summary:
      'The label must state the class and type of the product as defined by the Standards of Identity, such as "Kentucky Straight Bourbon Whiskey" or "India Pale Ale".',
  },
  alcoholContent: {
    section: '27 CFR §4.36 · §5.65 · §7.65',
    summary:
      'Alcohol content must be stated as a percentage of alcohol by volume, e.g. "45% Alc./Vol.". Spirits may also show proof, but not proof alone. Some wines and malt beverages are exempt.',
  },
  netContents: {
    section: '27 CFR §4.37 · §5.38 · §7.27',
    summary: 'The label must state the net contents, in metric units (mL or L) for wine and spirits.',
  },
  producer: {
    section: '27 CFR §4.35 · §5.36 · §7.25',
    summary: 'The label must name the bottler, producer or importer and give its address (at least city and state).',
  },
  countryOfOrigin: {
    section: null,
    summary:
      'Imported products must state their country of origin. This tool compares it when the application gives a country; it is not required on domestic labels.',
  },
  governmentWarning: {
    section: '27 CFR §16.21–16.22',
    summary:
      'Every container must carry the health warning word for word. "GOVERNMENT WARNING:" must be in capital letters and bold type, and the statement must be readable and separate from other text.',
  },
};

import { describe, it, expect } from 'vitest';
import governmentWarningRule from './government-warning';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_SENTENCE_1,
} from '../ttb-constants';
import { type ExtractedFields } from '../../extraction/types';

interface WarningInput {
  text: string | null;
  appearsAllCaps?: boolean | null;
  appearsBold?: boolean | null;
}

function fields(warning: WarningInput): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: {
      text: warning.text,
      appearsAllCaps: warning.appearsAllCaps ?? true,
      appearsBold: warning.appearsBold ?? true,
    },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    wineVarietal: null,
    wineAppellation: null,    extractionConfidence: 'high',
  };
}

describe('government-warning rule', () => {
  it('passes on the exact canonical text', () => {
    const result = governmentWarningRule.check(fields({ text: GOVERNMENT_WARNING_CANONICAL }));
    expect(result.status).toBe('pass');
  });

  it('passes when canonical text has extra whitespace (whitespace-normalized)', () => {
    const noisy = GOVERNMENT_WARNING_CANONICAL.replace(/ /g, '  ');
    const result = governmentWarningRule.check(fields({ text: noisy }));
    expect(result.status).toBe('pass');
  });

  it('fails when the GOVERNMENT WARNING: prefix is missing', () => {
    const noPrefix = GOVERNMENT_WARNING_CANONICAL.replace(
      'GOVERNMENT WARNING: ',
      '',
    );
    const result = governmentWarningRule.check(fields({ text: noPrefix }));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/prefix/i);
  });

  it('fails when sentence (2) about driving is missing', () => {
    const result = governmentWarningRule.check(
      fields({
        text: `GOVERNMENT WARNING: ${GOVERNMENT_WARNING_SENTENCE_1}`,
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/driving|second sentence|machinery/i);
  });

  it('fails when sentence (1) about pregnancy is missing', () => {
    const result = governmentWarningRule.check(
      fields({
        text: 'GOVERNMENT WARNING: (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.',
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/pregnancy|first sentence|Surgeon General/i);
  });

  it('fails on substantive phrasing change inside a sentence', () => {
    const drifted = GOVERNMENT_WARNING_CANONICAL.replace(
      'should not drink',
      'might want to consider not drinking',
    );
    const result = governmentWarningRule.check(fields({ text: drifted }));
    expect(result.status).toBe('fail');
    // Either "missing first sentence" (broke the exact-substring match for s1)
    // or "differs" is acceptable — both correctly identify the drift.
    expect(result.reason).toMatch(/differs|first sentence|pregnancy|Surgeon General/i);
  });

  it('fails with a generic differs reason when both sentences are present but text drifted around them', () => {
    // Insert extraneous content between sentences — both substrings still match,
    // but the overall normalized text doesn't equal canonical.
    const drifted = GOVERNMENT_WARNING_CANONICAL.replace(
      'birth defects. (2)',
      'birth defects. EXTRA INSERTED CONTENT. (2)',
    );
    const result = governmentWarningRule.check(fields({ text: drifted }));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/differs|required wording/i);
  });

  it('returns uncertain when text is correct but appearsBold is false', () => {
    const result = governmentWarningRule.check(
      fields({ text: GOVERNMENT_WARNING_CANONICAL, appearsBold: false }),
    );
    expect(result.status).toBe('uncertain');
    expect(result.reason).toMatch(/bold/i);
  });

  it('returns uncertain when text is correct but appearsAllCaps is false', () => {
    const result = governmentWarningRule.check(
      fields({
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: false,
        appearsBold: true,
      }),
    );
    expect(result.status).toBe('uncertain');
    expect(result.reason).toMatch(/all caps|capital/i);
  });

  it('fails when text is null', () => {
    const result = governmentWarningRule.check(fields({ text: null }));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/not detected|missing/i);
  });

  it('passes when text is correct and visual styling is null (model unsure)', () => {
    const result = governmentWarningRule.check(
      fields({
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsBold: null,
        appearsAllCaps: null,
      }),
    );
    expect(result.status).toBe('pass');
  });
});

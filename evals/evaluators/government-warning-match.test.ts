import { describe, it, expect } from 'vitest';
import { governmentWarningMatch } from './government-warning-match';
import { type ExtractedFields } from '../../src/lib/extraction/types';

const CANONICAL =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

function base(warningText: string | null): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: {
      text: warningText,
      appearsAllCaps: null,
      appearsBold: null,
    },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    extractionConfidence: 'high',
  };
}

describe('governmentWarningMatch', () => {
  it('scores 1 when canonical text matches in both', () => {
    const result = governmentWarningMatch(base(CANONICAL), base(CANONICAL));
    expect(result.score).toBe(1);
    expect(result.reason).toBeUndefined();
  });

  it('scores 1 when whitespace differs but text matches', () => {
    const spaced = CANONICAL.replace(/\s+/g, '  ');
    const result = governmentWarningMatch(base(CANONICAL), base(spaced));
    expect(result.score).toBe(1);
  });

  it('scores 0 when prefix is missing from actual', () => {
    const noPrefix = CANONICAL.replace('GOVERNMENT WARNING: ', '');
    const result = governmentWarningMatch(base(CANONICAL), base(noPrefix));
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/differs/i);
  });

  it('scores 1 when both expected and actual are null (label has no warning)', () => {
    const result = governmentWarningMatch(base(null), base(null));
    expect(result.score).toBe(1);
  });

  it('scores 0 when expected is null but actual is present (hallucination)', () => {
    const result = governmentWarningMatch(base(null), base(CANONICAL));
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/hallucinated/i);
  });

  it('scores 0 when expected is present but actual is null (missed)', () => {
    const result = governmentWarningMatch(base(CANONICAL), base(null));
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/missed/i);
  });

  it('scores 0 when sentence (2) is missing from actual', () => {
    const truncated =
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.';
    const result = governmentWarningMatch(base(CANONICAL), base(truncated));
    expect(result.score).toBe(0);
  });
});

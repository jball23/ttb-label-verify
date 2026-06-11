import { describe, it, expect } from 'vitest';
import abvRule from './abv';
import { type ExtractedFields } from '../../extraction/types';

function fields(abv: string | null): ExtractedFields {
  return {
    brandName: null,
    abv,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    wineVarietal: null,
    wineAppellation: null,    extractionConfidence: 'high',
  };
}

describe('abv rule', () => {
  it.each(['40% ALC/VOL', '40.0% Alcohol by Volume', '8.0%', '40', '45.5%'])(
    'passes on valid ABV: %s',
    (input) => {
      expect(abvRule.check(fields(input)).status).toBe('pass');
    },
  );

  it('fails when abv is null', () => {
    const result = abvRule.check(fields(null));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/abv|alcohol/i);
  });

  it.each(['forty percent', 'spirits', 'strong'])(
    'fails on non-numeric ABV: %s',
    (input) => {
      const result = abvRule.check(fields(input));
      expect(result.status).toBe('fail');
      expect(result.reason).toMatch(/recognized format|format|percentage|proof/i);
    },
  );

  it('accepts ABV with surrounding whitespace', () => {
    expect(abvRule.check(fields('  40% ALC/VOL  ')).status).toBe('pass');
  });
});

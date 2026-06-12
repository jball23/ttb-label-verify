import { describe, it, expect } from 'vitest';
import classTypeRule from './class-type';
import { type ExtractedFields } from '../../extraction/types';

function fields(classType: string | null): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType,
    producer: null,
    countryOfOrigin: null,
    wineVarietal: null,
    wineAppellation: null,    extractionConfidence: 'high',
  };
}

describe('class-type rule', () => {
  it('passes when a class designation is present', () => {
    expect(classTypeRule.check(fields('STRAIGHT BOURBON WHISKEY')).status).toBe(
      'pass',
    );
  });

  it('passes for BEER', () => {
    expect(classTypeRule.check(fields('BEER')).status).toBe('pass');
  });

  it('warns when null', () => {
    const result = classTypeRule.check(fields(null));
    expect(result.status).toBe('warn');
    expect(result.reason).toMatch(/class.*type|designation|fanciful/i);
  });

  it('warns when empty string', () => {
    expect(classTypeRule.check(fields('')).status).toBe('warn');
  });
});

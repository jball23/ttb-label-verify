import { describe, it, expect } from 'vitest';
import brandRule from './brand';
import { type ExtractedFields } from '../../extraction/types';

function fields(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brandName: 'Wild Acre',
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    extractionConfidence: 'high',
    ...overrides,
  };
}

describe('brand rule', () => {
  it('passes when brandName is a non-empty string', () => {
    expect(brandRule.check(fields({ brandName: 'Wild Acre' })).status).toBe('pass');
  });

  it('fails when brandName is null', () => {
    const result = brandRule.check(fields({ brandName: null }));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/brand name/i);
  });

  it('fails when brandName is an empty string', () => {
    const result = brandRule.check(fields({ brandName: '' }));
    expect(result.status).toBe('fail');
  });

  it('returns uncertain when brand present but extraction confidence is low', () => {
    const result = brandRule.check(
      fields({ brandName: 'Wild Acre', extractionConfidence: 'low' }),
    );
    expect(result.status).toBe('uncertain');
  });

  it('attaches the extractedValue on every result', () => {
    expect(brandRule.check(fields({ brandName: 'X' })).extractedValue).toBe('X');
  });
});

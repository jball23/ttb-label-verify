import { describe, it, expect } from 'vitest';
import producerOriginRule from './producer-origin';
import { type ExtractedFields } from '../../extraction/types';

function fields(producer: string | null, countryOfOrigin: string | null): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType: null,
    producer,
    countryOfOrigin,
    extractionConfidence: 'high',
  };
}

describe('producer-origin rule', () => {
  it('passes when both producer and country are present', () => {
    expect(
      producerOriginRule.check(fields('Wild Acre Distillery', 'USA')).status,
    ).toBe('pass');
  });

  it('fails with country-missing reason when only producer is present', () => {
    const result = producerOriginRule.check(fields('Wild Acre Distillery', null));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/country/i);
  });

  it('fails with producer-missing reason when only country is present', () => {
    const result = producerOriginRule.check(fields(null, 'USA'));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/producer/i);
  });

  it('fails when both are missing', () => {
    const result = producerOriginRule.check(fields(null, null));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/producer.*country|both/i);
  });

  it('fails when either is empty string', () => {
    expect(producerOriginRule.check(fields('', 'USA')).status).toBe('fail');
    expect(producerOriginRule.check(fields('Wild Acre', '')).status).toBe('fail');
  });
});

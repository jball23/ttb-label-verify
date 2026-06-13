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
    wineVarietal: null,
    wineAppellation: null,
    extractionConfidence: 'high',
  };
}

describe('producer-origin rule', () => {
  it('passes when both producer and country are present', () => {
    expect(
      producerOriginRule.check(fields('Wild Acre Distillery', 'USA')).status,
    ).toBe('pass');
  });

  it('warns with country-missing reason when only producer is present', () => {
    const result = producerOriginRule.check(fields('Wild Acre Distillery', null));
    expect(result.status).toBe('warn');
    expect(result.reason).toMatch(/country/i);
  });

  it('passes domestic brewer/producer address with a US state abbreviation', () => {
    const result = producerOriginRule.check(
      fields('Brewed by Twelve Percent, Westminster, MD', null),
    );
    expect(result.status).toBe('pass');
    expect(result.extractedValue).toContain('USA');
  });

  it('passes domestic producer address with a US state name', () => {
    const result = producerOriginRule.check(
      fields('Produced and Bottled by Chateau Sainte Genevieve, Bloomsdale, Missouri', null),
    );
    expect(result.status).toBe('pass');
    expect(result.extractedValue).toContain('USA');
  });

  it('does not treat a US importer address as domestic country of origin', () => {
    const result = producerOriginRule.check(
      fields('Imported by Boisset Collection, St Helena, CA', null),
    );
    expect(result.status).toBe('warn');
    expect(result.reason).toMatch(/country/i);
  });

  it('warns with producer-missing reason when only country is present', () => {
    const result = producerOriginRule.check(fields(null, 'USA'));
    expect(result.status).toBe('warn');
    expect(result.reason).toMatch(/producer/i);
  });

  it('warns when both are missing', () => {
    const result = producerOriginRule.check(fields(null, null));
    expect(result.status).toBe('warn');
    expect(result.reason).toMatch(/producer.*country|both/i);
  });

  it('warns when either is empty string', () => {
    expect(producerOriginRule.check(fields('', 'USA')).status).toBe('warn');
    expect(producerOriginRule.check(fields('Wild Acre', '')).status).toBe('warn');
  });
});

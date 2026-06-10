import { describe, it, expect } from 'vitest';
import { fieldExtractionAccuracy } from './field-extraction-accuracy';
import { type ExtractedFields } from '../../src/lib/extraction/types';

function base(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brandName: 'Wild Acre',
    abv: '45% ALC/VOL',
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: '750 mL',
    classType: 'BOURBON',
    producer: 'Wild Acre Distillery',
    countryOfOrigin: 'USA',
    extractionConfidence: 'high',
    ...overrides,
  };
}

describe('fieldExtractionAccuracy', () => {
  it('scores 1.0 across all fields when expected equals actual', () => {
    const result = fieldExtractionAccuracy(base(), base());
    expect(result.aggregate).toBe(1);
    expect(result.perField.every((f) => f.score === 1)).toBe(true);
  });

  it('scores 0 for a single differing field, 1 for the rest', () => {
    const result = fieldExtractionAccuracy(base(), base({ brandName: 'Wrong' }));
    const brand = result.perField.find((f) => f.field === 'brandName');
    expect(brand?.score).toBe(0);
    const others = result.perField.filter((f) => f.field !== 'brandName');
    expect(others.every((f) => f.score === 1)).toBe(true);
    expect(result.aggregate).toBeCloseTo(5 / 6);
  });

  it('scores 1 when both expected and actual are null for a field', () => {
    const result = fieldExtractionAccuracy(
      base({ producer: null, countryOfOrigin: null }),
      base({ producer: null, countryOfOrigin: null }),
    );
    expect(result.aggregate).toBe(1);
  });

  it('scores 0 when expected is null but actual has a value (hallucination)', () => {
    const result = fieldExtractionAccuracy(
      base({ producer: null }),
      base({ producer: 'Made Up Co.' }),
    );
    const producer = result.perField.find((f) => f.field === 'producer');
    expect(producer?.score).toBe(0);
  });

  it('scores 0 when expected has a value but actual is null (missed)', () => {
    const result = fieldExtractionAccuracy(
      base({ producer: 'Wild Acre Distillery' }),
      base({ producer: null }),
    );
    const producer = result.perField.find((f) => f.field === 'producer');
    expect(producer?.score).toBe(0);
  });

  it('ignores case when comparing strings', () => {
    const result = fieldExtractionAccuracy(
      base({ classType: 'BOURBON' }),
      base({ classType: 'bourbon' }),
    );
    expect(result.aggregate).toBe(1);
  });

  it('normalizes whitespace when comparing strings', () => {
    const result = fieldExtractionAccuracy(
      base({ producer: 'Wild Acre   Distillery' }),
      base({ producer: 'Wild Acre Distillery' }),
    );
    expect(result.aggregate).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { ExtractedFieldsSchema } from './types';

describe('ExtractedFieldsSchema', () => {
  it('accepts a fully-populated valid object', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: 'Wild Acre Distillery',
      abv: '45% ALC/VOL',
      governmentWarning: {
        text: 'GOVERNMENT WARNING: (1) According to the Surgeon General...',
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'STRAIGHT BOURBON WHISKEY',
      producer: 'Bottled by Wild Acre Distillery',
      countryOfOrigin: 'USA',
      extractionConfidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an object with all fields nulled', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: null,
      abv: null,
      governmentWarning: {
        text: null,
        appearsAllCaps: null,
        appearsBold: null,
      },
      netContents: null,
      classType: null,
      producer: null,
      countryOfOrigin: null,
      extractionConfidence: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when a string field is a number', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: 42,
      abv: null,
      governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
      netContents: null,
      classType: null,
      producer: null,
      countryOfOrigin: null,
      extractionConfidence: 'medium',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when extractionConfidence is not one of the allowed values', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: null,
      abv: null,
      governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
      netContents: null,
      classType: null,
      producer: null,
      countryOfOrigin: null,
      extractionConfidence: 'pretty-good',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when governmentWarning is missing', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: null,
      abv: null,
      netContents: null,
      classType: null,
      producer: null,
      countryOfOrigin: null,
      extractionConfidence: 'high',
    });
    expect(result.success).toBe(false);
  });
});

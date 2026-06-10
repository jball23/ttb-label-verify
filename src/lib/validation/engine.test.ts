import { describe, it, expect } from 'vitest';
import { runRules } from './engine';
import { GOVERNMENT_WARNING_CANONICAL } from './ttb-constants';
import { type ExtractedFields } from '../extraction/types';

function compliant(): ExtractedFields {
  return {
    brandName: 'Wild Acre Distillery',
    abv: '45% ALC/VOL',
    governmentWarning: {
      text: GOVERNMENT_WARNING_CANONICAL,
      appearsAllCaps: true,
      appearsBold: true,
    },
    netContents: '750 mL',
    classType: 'STRAIGHT BOURBON WHISKEY',
    producer: 'Bottled by Wild Acre Distillery, Louisville, KY',
    countryOfOrigin: 'USA',
    extractionConfidence: 'high',
  };
}

function empty(): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    extractionConfidence: 'low',
  };
}

describe('runRules', () => {
  it('returns compliant when every rule passes', () => {
    const report = runRules(compliant());
    expect(report.overallStatus).toBe('compliant');
    for (const field of Object.values(report.fields)) {
      expect(field.status).toBe('pass');
    }
  });

  it('returns needs_review when any single rule fails', () => {
    const report = runRules({ ...compliant(), brandName: null });
    expect(report.overallStatus).toBe('needs_review');
    expect(report.fields.brand?.status).toBe('fail');
    expect(report.fields.abv?.status).toBe('pass');
  });

  it('returns needs_review when Government Warning is missing', () => {
    const report = runRules({
      ...compliant(),
      governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    });
    expect(report.overallStatus).toBe('needs_review');
    expect(report.fields.governmentWarning?.status).toBe('fail');
  });

  it('returns compliant when all fields are uncertain (low confidence) but none fail', () => {
    const report = runRules({
      ...compliant(),
      extractionConfidence: 'low',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: false,
        appearsBold: true,
      },
    });
    expect(report.overallStatus).toBe('compliant');
    expect(report.fields.governmentWarning?.status).toBe('uncertain');
    expect(report.fields.brand?.status).toBe('uncertain');
  });

  it('returns needs_review with every field failed when ExtractedFields is empty', () => {
    const report = runRules(empty());
    expect(report.overallStatus).toBe('needs_review');
    for (const field of Object.values(report.fields)) {
      expect(field.status).toBe('fail');
    }
  });

  it('preserves rule order in the fields output', () => {
    const report = runRules(compliant());
    const keys = Object.keys(report.fields);
    expect(keys).toEqual([
      'brand',
      'abv',
      'governmentWarning',
      'netContents',
      'classType',
      'producerOrigin',
    ]);
  });
});

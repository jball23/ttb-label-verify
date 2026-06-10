import { describe, it, expect } from 'vitest';
import { countByStatus, liveRegionMessage, isBatchComplete } from './aggregate';
import { type ResultLine } from './result-types';

function ok(overall: 'compliant' | 'needs_review', index = 0): ResultLine {
  return {
    status: 'ok',
    index,
    filename: 'a.jpg',
    durationMs: 100,
    report: { overallStatus: overall, crossCheck: { overallStatus: 'match', fields: {} }, fields: {}, provenance: {}, extractedForm: {  plantRegistryNumber: null,  source: null,  serialNumber: null,  productType: null,  brandName: null,  fancifulName: null,  applicant: { name: null, addressLine1: null, city: null, state: null, postalCode: null },  grapeVarietals: null,  wineAppellation: null,  phone: null,  email: null,  applicationType: null,  applicationDate: null,  applicantSignatureName: null, } as any, extractedLabel: {  brandName: null, abv: null,  governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },  netContents: null, classType: null, producer: null, countryOfOrigin: null,  wineVarietal: null, wineAppellation: null, extractionConfidence: 'high', } as any, },
  };
}

function err(index = 0): ResultLine {
  return {
    status: 'error',
    index,
    filename: 'a.jpg',
    durationMs: 0,
    errorMessage: 'broken',
  };
}

describe('countByStatus', () => {
  it('returns all zeros for an empty list', () => {
    expect(countByStatus([])).toEqual({ compliant: 0, needsReview: 0, error: 0 });
  });

  it('counts mixed results correctly', () => {
    const result = countByStatus([
      ok('compliant'),
      ok('compliant'),
      ok('needs_review'),
      err(),
    ]);
    expect(result).toEqual({ compliant: 2, needsReview: 1, error: 1 });
  });
});

describe('liveRegionMessage', () => {
  it('returns empty string when nothing has happened yet', () => {
    expect(liveRegionMessage(0, 10)).toBe('');
  });

  it('returns empty string when total is 0', () => {
    expect(liveRegionMessage(5, 0)).toBe('');
  });

  it('formats partial progress', () => {
    expect(liveRegionMessage(3, 10)).toBe('3 of 10 labels checked.');
  });

  it('formats completion', () => {
    expect(liveRegionMessage(10, 10)).toBe('All 10 labels checked.');
  });
});

describe('isBatchComplete', () => {
  it('returns false when no labels expected', () => {
    expect(isBatchComplete(0, 0)).toBe(false);
  });

  it('returns false when received < total', () => {
    expect(isBatchComplete(2, 5)).toBe(false);
  });

  it('returns true when received >= total', () => {
    expect(isBatchComplete(5, 5)).toBe(true);
    expect(isBatchComplete(6, 5)).toBe(true);
  });
});

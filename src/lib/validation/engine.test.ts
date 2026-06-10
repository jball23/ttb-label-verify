import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runRules, runVerification } from './engine';
import { GOVERNMENT_WARNING_CANONICAL } from './ttb-constants';
import { type ExtractedFields } from '../extraction/types';
import { parseApplication } from '../application/loader';
import type { Application } from '../application/types';

function loadApplication(slug: string): Application {
  const file = path.join(
    process.cwd(),
    'public',
    'samples',
    'applications',
    slug,
    'application.json',
  );
  return parseApplication(JSON.parse(readFileSync(file, 'utf8')));
}

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
    wineVarietal: null,
    wineAppellation: null,
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
    wineVarietal: null,
    wineAppellation: null,
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

  it('returns an empty crossCheck section so the report shape stays consistent', () => {
    const report = runRules(compliant());
    expect(report.crossCheck.overallStatus).toBe('match');
    expect(report.crossCheck.fields.brandName.status).toBe('not_applicable');
  });
});

describe('runVerification', () => {
  it('compliant when cross-check matches AND all rules pass (scenario 01)', () => {
    const application = loadApplication('01-ridge-creek-bourbon');
    const extracted: ExtractedFields = {
      brandName: 'Ridge Creek',
      abv: '45% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Kentucky Straight Bourbon Whiskey',
      producer:
        'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    };
    const report = runVerification(application, extracted);
    expect(report.overallStatus).toBe('compliant');
  });

  it('needs_review when cross-check mismatches even if all rules pass (scenario 02)', () => {
    const application = loadApplication('02-silver-birch-vodka');
    const extracted: ExtractedFields = {
      brandName: 'Silver Birch Premium',
      abv: '40% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Vodka',
      producer:
        'Distilled and bottled by Northern Spirits Co. · Portland, Oregon',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    };
    const report = runVerification(application, extracted);
    expect(report.overallStatus).toBe('needs_review');
    expect(report.crossCheck.overallStatus).toBe('mismatch');
    expect(report.crossCheck.fields.brandName.status).toBe('mismatch');
    expect(report.fields.brand?.status).toBe('pass');
  });

  it('needs_review when label-only rule fails even if cross-check matches (scenario 04)', () => {
    const application = loadApplication('04-ironwood-ipa');
    const extracted: ExtractedFields = {
      brandName: 'Ironwood Brewing',
      abv: '6.8% ALC/VOL',
      governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
      netContents: '12 FL OZ',
      classType: 'India Pale Ale',
      producer:
        'Brewed and canned by Ironwood Brewing Co. · Asheville, North Carolina',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    };
    const report = runVerification(application, extracted);
    expect(report.overallStatus).toBe('needs_review');
    expect(report.crossCheck.overallStatus).toBe('match');
    expect(report.fields.governmentWarning?.status).toBe('fail');
  });

  it('uncertain rules alone do not flip overall status', () => {
    const application = loadApplication('01-ridge-creek-bourbon');
    const extracted: ExtractedFields = {
      brandName: 'Ridge Creek',
      abv: '45% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Kentucky Straight Bourbon Whiskey',
      producer:
        'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'low',
    };
    const report = runVerification(application, extracted);
    expect(report.overallStatus).toBe('compliant');
  });
});

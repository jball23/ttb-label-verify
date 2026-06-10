import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseApplication } from '../application/loader';
import type { Application } from '../application/types';
import type { ExtractedFields } from '../extraction/types';
import { runCrossCheck } from './engine';

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

const baseExtracted: ExtractedFields = {
  brandName: null,
  abv: null,
  governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
  netContents: null,
  classType: null,
  producer: null,
  countryOfOrigin: null,
  wineVarietal: null,
  wineAppellation: null,
  extractionConfidence: 'high',
};

describe('runCrossCheck — truth table', () => {
  it('scenario 01 ridge creek bourbon: all match', () => {
    const application = loadApplication('01-ridge-creek-bourbon');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Ridge Creek',
      classType: 'Kentucky Straight Bourbon Whiskey',
      producer:
        'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky',
      countryOfOrigin: 'USA',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.overallStatus).toBe('match');
    expect(report.fields.brandName.status).toBe('match');
    expect(report.fields.classType.status).toBe('match');
    expect(report.fields.producer.status).toBe('match');
    expect(report.fields.countryOfOrigin.status).toBe('match');
    expect(report.fields.wineVarietal.status).toBe('not_applicable');
    expect(report.fields.wineAppellation.status).toBe('not_applicable');
  });

  it('scenario 02 silver birch: brand mismatch', () => {
    const application = loadApplication('02-silver-birch-vodka');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Silver Birch Premium',
      classType: 'Vodka',
      producer:
        'Distilled and bottled by Northern Spirits Co. · Portland, Oregon',
      countryOfOrigin: 'USA',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.overallStatus).toBe('mismatch');
    expect(report.fields.brandName.status).toBe('mismatch');
    expect(report.fields.classType.status).toBe('match');
    expect(report.fields.producer.status).toBe('match');
    expect(report.fields.countryOfOrigin.status).toBe('match');
  });

  it('scenario 03 hawthorne cabernet: varietal + appellation mismatch', () => {
    const application = loadApplication('03-hawthorne-cabernet');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Hawthorne Vineyards',
      classType: 'Merlot',
      producer:
        'Produced and bottled by Hawthorne Cellars, Inc. · Healdsburg, California',
      countryOfOrigin: 'USA',
      wineVarietal: 'Merlot',
      wineAppellation: 'Sonoma County',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.overallStatus).toBe('mismatch');
    expect(report.fields.brandName.status).toBe('match');
    expect(report.fields.producer.status).toBe('match');
    expect(report.fields.wineVarietal.status).toBe('mismatch');
    expect(report.fields.wineAppellation.status).toBe('mismatch');
  });

  it('scenario 04 ironwood ipa: cross-check all match (label-only failure handled by rules)', () => {
    const application = loadApplication('04-ironwood-ipa');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Ironwood Brewing',
      classType: 'India Pale Ale',
      producer:
        'Brewed and canned by Ironwood Brewing Co. · Asheville, North Carolina',
      countryOfOrigin: 'USA',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.overallStatus).toBe('match');
    expect(report.fields.classType.status).toBe('match');
    expect(report.fields.wineVarietal.status).toBe('not_applicable');
    expect(report.fields.wineAppellation.status).toBe('not_applicable');
  });

  it('scenario 05 calypso rum: producer mismatch', () => {
    const application = loadApplication('05-calypso-rum');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Calypso Sands',
      classType: 'Aged Caribbean Rum',
      producer: 'Bottled by Tropical Spirits LLC · San Juan, Puerto Rico',
      countryOfOrigin: 'USA',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.overallStatus).toBe('mismatch');
    expect(report.fields.brandName.status).toBe('match');
    expect(report.fields.classType.status).toBe('match');
    expect(report.fields.producer.status).toBe('mismatch');
  });
});

describe('runCrossCheck — status fan-out', () => {
  it('returns not_on_label when application expects a value but label is null', () => {
    const application = loadApplication('03-hawthorne-cabernet');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Hawthorne Vineyards',
      classType: 'Cabernet Sauvignon',
      producer:
        'Produced and bottled by Hawthorne Cellars, Inc. · Healdsburg, California',
      countryOfOrigin: 'USA',
      wineVarietal: null, // missing on label
      wineAppellation: 'Napa Valley',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.fields.wineVarietal.status).toBe('not_on_label');
    expect(report.overallStatus).toBe('mismatch');
  });

  it('marks wine fields as not_applicable for non-wine product type', () => {
    const application = loadApplication('01-ridge-creek-bourbon');
    const extracted: ExtractedFields = {
      ...baseExtracted,
      brandName: 'Ridge Creek',
      classType: 'Kentucky Straight Bourbon Whiskey',
      producer:
        'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky',
      countryOfOrigin: 'USA',
      wineVarietal: 'Cabernet Sauvignon', // bogus — should be ignored
      wineAppellation: 'Napa Valley',
    };
    const report = runCrossCheck(application, extracted);
    expect(report.fields.wineVarietal.status).toBe('not_applicable');
    expect(report.fields.wineAppellation.status).toBe('not_applicable');
    expect(report.overallStatus).toBe('match');
  });

  it('all label fields null produces a flood of not_on_label', () => {
    const application = loadApplication('01-ridge-creek-bourbon');
    const report = runCrossCheck(application, baseExtracted);
    expect(report.overallStatus).toBe('mismatch');
    expect(report.fields.brandName.status).toBe('not_on_label');
    expect(report.fields.classType.status).toBe('not_on_label');
    expect(report.fields.producer.status).toBe('not_on_label');
    expect(report.fields.countryOfOrigin.status).toBe('not_on_label');
  });
});

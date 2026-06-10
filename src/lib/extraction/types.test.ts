import { describe, it, expect } from 'vitest';
import {
  ExtractedDocumentSchema,
  ExtractedFieldsSchema,
  FieldPathSchema,
  FieldProvenanceSchema,
} from './types';

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
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts wine fields populated with grape varietal and appellation', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: 'Hawthorne Vineyards',
      abv: '13.5% ALC/VOL',
      governmentWarning: {
        text: 'GOVERNMENT WARNING: ...',
        appearsAllCaps: true,
        appearsBold: false,
      },
      netContents: '750 mL',
      classType: 'CABERNET SAUVIGNON',
      producer: 'Produced and bottled by Hawthorne Cellars, Inc.',
      countryOfOrigin: 'USA',
      wineVarietal: 'Cabernet Sauvignon',
      wineAppellation: 'Napa Valley',
      extractionConfidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when wineVarietal is a number', () => {
    const result = ExtractedFieldsSchema.safeParse({
      brandName: null,
      abv: null,
      governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
      netContents: null,
      classType: null,
      producer: null,
      countryOfOrigin: null,
      wineVarietal: 42,
      wineAppellation: null,
      extractionConfidence: 'medium',
    });
    expect(result.success).toBe(false);
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
      wineVarietal: null,
      wineAppellation: null,
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
      wineVarietal: null,
      wineAppellation: null,
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
      wineVarietal: null,
      wineAppellation: null,
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
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    });
    expect(result.success).toBe(false);
  });
});

describe('FieldPathSchema', () => {
  it('accepts a known application path', () => {
    expect(FieldPathSchema.safeParse('application.brandName').success).toBe(true);
  });

  it('accepts a known label path', () => {
    expect(FieldPathSchema.safeParse('label.governmentWarning').success).toBe(true);
  });

  it('rejects an unknown path', () => {
    expect(FieldPathSchema.safeParse('application.unknownField').success).toBe(false);
  });
});

describe('FieldProvenanceSchema', () => {
  it('accepts a fully-populated entry', () => {
    expect(
      FieldProvenanceSchema.safeParse({
        page: 0,
        bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
        confidence: 'high',
      }).success,
    ).toBe(true);
  });

  it('rejects a bbox component outside 0..1', () => {
    expect(
      FieldProvenanceSchema.safeParse({
        page: 0,
        bbox: { x: 1.5, y: 0, w: 0.1, h: 0.1 },
        confidence: 'medium',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown confidence tier', () => {
    expect(
      FieldProvenanceSchema.safeParse({
        page: 0,
        bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
        confidence: 'pretty-good',
      }).success,
    ).toBe(false);
  });

  it('rejects a negative page index', () => {
    expect(
      FieldProvenanceSchema.safeParse({
        page: -1,
        bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
        confidence: 'high',
      }).success,
    ).toBe(false);
  });
});

describe('ExtractedDocumentSchema', () => {
  const validLabel = {
    brandName: 'Ridge Creek',
    abv: '45% ALC/VOL',
    governmentWarning: {
      text: 'GOVERNMENT WARNING: ...',
      appearsAllCaps: true,
      appearsBold: true,
    },
    netContents: '750 mL',
    classType: 'KENTUCKY STRAIGHT BOURBON WHISKEY',
    producer: 'Distilled and Bottled by Ridge Creek Distillery, LLC',
    countryOfOrigin: 'USA',
    wineVarietal: null,
    wineAppellation: null,
    extractionConfidence: 'high' as const,
  };

  const validApplication = {
    plantRegistryNumber: 'DSP-KY-20158',
    source: 'Domestic' as const,
    serialNumber: '26-0117',
    productType: 'DISTILLED SPIRITS' as const,
    brandName: 'Ridge Creek',
    fancifulName: 'Kentucky Straight Bourbon Whiskey',
    applicant: {
      name: 'Ridge Creek Distillery, LLC',
      addressLine1: '142 Limestone Road',
      city: 'Bardstown',
      state: 'KY',
      postalCode: '40004',
    },
    grapeVarietals: null,
    wineAppellation: null,
    phone: null,
    email: null,
    applicationType: null,
    applicationDate: '2026-05-22',
    applicantSignatureName: 'Margaret Hollister',
  };

  const validProvenance = {
    'application.brandName': {
      page: 0,
      bbox: { x: 0.1, y: 0.15, w: 0.2, h: 0.03 },
      confidence: 'high' as const,
    },
    'label.brandName': {
      page: 0,
      bbox: { x: 0.4, y: 0.85, w: 0.18, h: 0.04 },
      confidence: 'medium' as const,
    },
  };

  it('accepts a full, valid document', () => {
    expect(
      ExtractedDocumentSchema.safeParse({
        application: validApplication,
        label: validLabel,
        provenance: validProvenance,
      }).success,
    ).toBe(true);
  });

  it('accepts an empty provenance map', () => {
    expect(
      ExtractedDocumentSchema.safeParse({
        application: validApplication,
        label: validLabel,
        provenance: {},
      }).success,
    ).toBe(true);
  });

  it('rejects a provenance entry under an unknown field path', () => {
    expect(
      ExtractedDocumentSchema.safeParse({
        application: validApplication,
        label: validLabel,
        provenance: {
          'application.bogusField': {
            page: 0,
            bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
            confidence: 'high',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects when label half is missing', () => {
    expect(
      ExtractedDocumentSchema.safeParse({
        application: validApplication,
        provenance: {},
      }).success,
    ).toBe(false);
  });

  it('accepts an application with all optional fields null', () => {
    const nulledApplication = {
      plantRegistryNumber: null,
      source: null,
      serialNumber: null,
      productType: null,
      brandName: null,
      fancifulName: null,
      applicant: {
        name: null,
        addressLine1: null,
        city: null,
        state: null,
        postalCode: null,
      },
      grapeVarietals: null,
      wineAppellation: null,
      phone: null,
      email: null,
      applicationType: null,
      applicationDate: null,
      applicantSignatureName: null,
    };
    expect(
      ExtractedDocumentSchema.safeParse({
        application: nulledApplication,
        label: validLabel,
        provenance: {},
      }).success,
    ).toBe(true);
  });
});

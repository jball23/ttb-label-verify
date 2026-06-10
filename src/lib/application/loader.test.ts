import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseApplication,
  synthesizeExpectations,
  InvalidApplicationError,
} from './loader';
import type { ExtractedApplicationForm } from '../extraction/types';

const SCENARIOS = [
  '01-ridge-creek-bourbon',
  '02-silver-birch-vodka',
  '03-hawthorne-cabernet',
  '04-ironwood-ipa',
  '05-calypso-rum',
] as const;
type Scenario = (typeof SCENARIOS)[number];

function loadFixture(slug: Scenario): unknown {
  const file = path.join(
    process.cwd(),
    'public',
    'samples',
    'applications',
    slug,
    'application.json',
  );
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('parseApplication', () => {
  it.each(SCENARIOS)('parses scenario fixture %s', (slug) => {
    const raw = loadFixture(slug);
    const parsed = parseApplication(raw);
    expect(parsed.scenarioId).toBe(slug);
    expect(parsed.form.brandName).toBeTruthy();
  });

  it('throws InvalidApplicationError when form.brandName is missing', () => {
    const raw = loadFixture(SCENARIOS[0]) as { form: Record<string, unknown> };
    delete raw.form.brandName;
    expect(() => parseApplication(raw)).toThrow(InvalidApplicationError);
  });

  it('throws when form.productType is not in the enum', () => {
    const raw = loadFixture(SCENARIOS[0]) as { form: Record<string, unknown> };
    raw.form.productType = 'BEER';
    expect(() => parseApplication(raw)).toThrow(InvalidApplicationError);
  });

  it('accepts an application without intentionalMismatches (optional field)', () => {
    const raw = loadFixture(SCENARIOS[0]) as Record<string, unknown>;
    delete raw.intentionalMismatches;
    const parsed = parseApplication(raw);
    expect(parsed.intentionalMismatches).toBeUndefined();
  });

  it('rejects when crossCheckExpectations.wineVarietal is a number', () => {
    const raw = loadFixture(SCENARIOS[2]) as {
      crossCheckExpectations: Record<string, unknown>;
    };
    raw.crossCheckExpectations.wineVarietal = 42;
    expect(() => parseApplication(raw)).toThrow(InvalidApplicationError);
  });

  it('error message includes field paths for easy debugging', () => {
    const raw = loadFixture(SCENARIOS[0]) as { form: Record<string, unknown> };
    raw.form.productType = 'BEER';
    try {
      parseApplication(raw);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidApplicationError);
      expect((e as Error).message).toMatch(/form\.productType/);
    }
  });
});

function formFromScenario(slug: Scenario): ExtractedApplicationForm {
  const raw = loadFixture(slug) as { form: Record<string, unknown> };
  const f = raw.form;
  const applicant = f.applicant as Record<string, string | null>;
  return {
    plantRegistryNumber: (f.plantRegistryNumber as string | null) ?? null,
    source: (f.source as 'Domestic' | 'Imported' | null) ?? null,
    serialNumber: (f.serialNumber as string | null) ?? null,
    productType:
      (f.productType as 'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES' | null) ??
      null,
    brandName: (f.brandName as string | null) ?? null,
    fancifulName: (f.fancifulName as string | null) ?? null,
    applicant: {
      name: applicant.name ?? null,
      addressLine1: applicant.addressLine1 ?? null,
      city: applicant.city ?? null,
      state: applicant.state ?? null,
      postalCode: applicant.postalCode ?? null,
    },
    grapeVarietals: (f.grapeVarietals as string | null) ?? null,
    wineAppellation: (f.wineAppellation as string | null) ?? null,
    applicationDate: (f.applicationDate as string | null) ?? null,
    applicantSignatureName: (f.applicantSignatureName as string | null) ?? null,
  };
}

describe('synthesizeExpectations', () => {
  it.each(SCENARIOS)(
    'produces an Application that parses cleanly for scenario %s',
    (slug) => {
      const form = formFromScenario(slug);
      const synthesized = synthesizeExpectations(form);
      const reparsed = parseApplication(synthesized);
      expect(reparsed.form.brandName).toBe(synthesized.form.brandName);
    },
  );

  it('matches scenario 01 producer string format', () => {
    const form = formFromScenario('01-ridge-creek-bourbon');
    const synth = synthesizeExpectations(form);
    expect(synth.crossCheckExpectations.producer).toBe(
      'Ridge Creek Distillery, LLC, Bardstown, KY',
    );
  });

  it('matches scenario 01 classType (uses fancifulName)', () => {
    const form = formFromScenario('01-ridge-creek-bourbon');
    const synth = synthesizeExpectations(form);
    expect(synth.crossCheckExpectations.classType).toBe(
      'Kentucky Straight Bourbon Whiskey',
    );
  });

  it('omits wineVarietal/wineAppellation for non-wine product types', () => {
    const form = formFromScenario('01-ridge-creek-bourbon');
    const synth = synthesizeExpectations(form);
    expect(synth.crossCheckExpectations.wineVarietal).toBeUndefined();
    expect(synth.crossCheckExpectations.wineAppellation).toBeUndefined();
    expect(synth.form.grapeVarietals).toBeNull();
  });

  it('populates wineVarietal/wineAppellation for wine product types', () => {
    const form = formFromScenario('03-hawthorne-cabernet');
    const synth = synthesizeExpectations(form);
    expect(synth.crossCheckExpectations.wineVarietal).toBeTruthy();
    expect(synth.crossCheckExpectations.wineAppellation).toBeTruthy();
  });

  it('defaults countryOfOrigin to USA for Domestic source', () => {
    const form = formFromScenario('01-ridge-creek-bourbon');
    const synth = synthesizeExpectations(form);
    expect(synth.crossCheckExpectations.countryOfOrigin).toBe('USA');
  });

  it('handles all-null form gracefully (no throws on parseApplication)', () => {
    const blank: ExtractedApplicationForm = {
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
      applicationDate: null,
      applicantSignatureName: null,
    };
    const synth = synthesizeExpectations(blank);
    expect(() => parseApplication(synth)).not.toThrow();
    expect(synth.crossCheckExpectations.producer).toBe('');
  });
});

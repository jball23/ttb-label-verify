import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseApplication, InvalidApplicationError } from './loader';

const SCENARIOS = [
  '01-ridge-creek-bourbon',
  '02-silver-birch-vodka',
  '03-hawthorne-cabernet',
  '04-ironwood-ipa',
  '05-calypso-rum',
];

function loadFixture(slug: string): unknown {
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

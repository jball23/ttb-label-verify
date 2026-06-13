import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderApplicationPages } from './render';
import { parseApplicationFormFromRenderedPages } from './parse-form';
import { synthesizeExpectations } from '../application/loader';

const COLA_DIR = path.resolve(__dirname, '../../../public/samples/cola');

async function parseSample(filename: string) {
  const pdf = await readFile(path.join(COLA_DIR, filename));
  const pages = await renderApplicationPages(pdf);
  const parsed = await parseApplicationFormFromRenderedPages(pages);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe('parseApplicationFormFromRenderedPages', () => {
  it('parses a domestic wine form and treats N/A grape varietal as no expectation', async () => {
    const parsed = await parseSample(
      '26091001000783-chateau-sainte-genevieve.pdf',
    );

    expect(parsed.application.productType).toBe('WINE');
    expect(parsed.application.source).toBe('Domestic');
    expect(parsed.application.brandName).toBe('CHATEAU SAINTE GENEVIEVE');
    expect(parsed.application.fancifulName).toBe('HOMESTEAD HARVEST');
    expect(parsed.application.grapeVarietals).toBeNull();
    expect(parsed.application.wineAppellation).toBe('AMERICAN');
    expect(parsed.application.applicant.name).toBe('CHATEAU SAINTE GENEVIEVE');
    expect(parsed.bboxes['application.brandName']?.source).toBe('pdf');
    expect(parsed.bboxes['application.grapeVarietals']).toBeUndefined();
  });

  it('parses an imported distilled spirits form without wine-only fields', async () => {
    const parsed = await parseSample('26062001000676-soplica-apricot.pdf');

    expect(parsed.application.productType).toBe('DISTILLED SPIRITS');
    expect(parsed.application.source).toBe('Imported');
    expect(parsed.application.brandName).toBe('SOPLICA');
    expect(parsed.application.fancifulName).toBe('APRICOT');
    expect(parsed.application.grapeVarietals).toBeNull();
    expect(parsed.application.wineAppellation).toBeNull();
    expect(parsed.bboxes['application.wineAppellation']).toBeUndefined();
  });

  it('parses the full Item 7 fanciful name across the left column', async () => {
    const parsed = await parseSample(
      '26075001000643-layback-coconut-blanco.pdf',
    );
    const synthesized = synthesizeExpectations(parsed.application);

    expect(parsed.application.brandName).toBe('LAYBACK');
    expect(parsed.application.fancifulName).toBe("BETTY'S COCONUT BLANCO");
    expect(synthesized.crossCheckExpectations.classType).toBe(
      "BETTY'S COCONUT BLANCO",
    );
    expect(
      parsed.bboxes['application.fancifulName']?.words.map((word) => word.text),
    ).toContain('BLANCO');
  });

  it('parses a domestic malt beverage form from the checkbox state', async () => {
    const parsed = await parseSample(
      '26069001000588-country-and-western-ale.pdf',
    );

    expect(parsed.application.productType).toBe('MALT BEVERAGES');
    expect(parsed.application.source).toBe('Domestic');
    expect(parsed.application.brandName).toBe('COUNTRY & WESTERN');
    expect(parsed.application.applicant.city).toBe('Austin');
    expect(parsed.application.applicant.state).toBe('TX');
  });
});

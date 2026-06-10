import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resetEnvForTesting } from '@/lib/env';
import { resetObservabilityForTesting } from '@/lib/observability/langfuse';
import { ResultLineSchema, type ResultLine } from '@/lib/results/result-types';
import { GOVERNMENT_WARNING_CANONICAL } from '@/lib/validation/ttb-constants';
import { type ExtractedFields } from '@/lib/extraction/types';

const ORIGINAL_ENV = { ...process.env };

function setEnv(): void {
  process.env.DEMO_PASSWORD = 'pw';
  process.env.DEMO_PASSWORD_COOKIE_SECRET = 'a'.repeat(32);
  process.env.LABEL_EXTRACTOR = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test';
  resetEnvForTesting();
  resetObservabilityForTesting();
}

function loadApplicationJson(slug: string): string {
  return readFileSync(
    path.join(
      process.cwd(),
      'public',
      'samples',
      'applications',
      slug,
      'application.json',
    ),
    'utf8',
  );
}

function makeFile(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array(256)], name, { type });
}

function buildFormData(applicationJson: string, file: File): FormData {
  const fd = new FormData();
  fd.append('application', applicationJson);
  fd.append('file-0', file, file.name);
  return fd;
}

function fakeRequest(formData: FormData): { formData: () => Promise<FormData> } {
  return { formData: async () => formData };
}

async function readNDJSON(response: Response): Promise<ResultLine[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const lines: ResultLine[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim().length > 0) {
        lines.push(ResultLineSchema.parse(JSON.parse(line)));
      }
      idx = buffer.indexOf('\n');
    }
  }
  if (buffer.trim().length > 0) {
    lines.push(ResultLineSchema.parse(JSON.parse(buffer)));
  }
  return lines;
}

const SCENARIOS = [
  {
    slug: '01-ridge-creek-bourbon',
    expectedVerdict: 'compliant',
    extracted: (): ExtractedFields => ({
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
    }),
    expectedCrossCheckMismatches: [] as string[],
    expectedRuleFails: [] as string[],
  },
  {
    slug: '02-silver-birch-vodka',
    expectedVerdict: 'needs_review',
    extracted: (): ExtractedFields => ({
      brandName: 'Silver Birch Premium', // intentional drift
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
    }),
    expectedCrossCheckMismatches: ['brandName'],
    expectedRuleFails: [],
  },
  {
    slug: '03-hawthorne-cabernet',
    expectedVerdict: 'needs_review',
    extracted: (): ExtractedFields => ({
      brandName: 'Hawthorne Vineyards',
      abv: '13.5% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Merlot',
      producer:
        'Produced and bottled by Hawthorne Cellars, Inc. · Healdsburg, California',
      countryOfOrigin: 'USA',
      wineVarietal: 'Merlot', // wrong wine
      wineAppellation: 'Sonoma County', // wrong appellation
      extractionConfidence: 'high',
    }),
    expectedCrossCheckMismatches: ['wineVarietal', 'wineAppellation'],
    expectedRuleFails: [],
  },
  {
    slug: '04-ironwood-ipa',
    expectedVerdict: 'needs_review',
    extracted: (): ExtractedFields => ({
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
    }),
    expectedCrossCheckMismatches: [],
    expectedRuleFails: ['governmentWarning'],
  },
  {
    slug: '05-calypso-rum',
    expectedVerdict: 'needs_review',
    extracted: (): ExtractedFields => ({
      brandName: 'Calypso Sands',
      abv: '80 PROOF', // no % ABV
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Aged Caribbean Rum',
      producer: 'Bottled by Tropical Spirits LLC · San Juan, Puerto Rico',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    }),
    expectedCrossCheckMismatches: ['producer'],
    expectedRuleFails: ['abv'],
  },
] as const;

describe('POST /api/verify — 5-scenario truth table', () => {
  beforeEach(() => {
    setEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    resetEnvForTesting();
    resetObservabilityForTesting();
    vi.restoreAllMocks();
  });

  it.each(SCENARIOS)(
    '$slug → $expectedVerdict',
    async (scenario) => {
      const extractedFields = scenario.extracted();
      vi.doMock('@/lib/extraction/factory', () => ({
        getExtractor: () => ({
          providerName: 'fake',
          extract: async () => extractedFields,
        }),
      }));
      const { POST } = await import('./route');

      const fd = buildFormData(
        loadApplicationJson(scenario.slug),
        makeFile(`${scenario.slug}.jpg`),
      );
      const res = await POST(fakeRequest(fd) as never);
      expect(res.status).toBe(200);
      const lines = await readNDJSON(res);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line?.status).toBe('ok');
      if (line?.status !== 'ok') throw new Error('expected ok line');

      expect(line.report.overallStatus).toBe(scenario.expectedVerdict);

      for (const fieldId of scenario.expectedCrossCheckMismatches) {
        const result =
          line.report.crossCheck.fields[
            fieldId as keyof typeof line.report.crossCheck.fields
          ];
        expect(result?.status, `${fieldId} should mismatch`).toBe('mismatch');
      }
      for (const ruleId of scenario.expectedRuleFails) {
        expect(line.report.fields[ruleId]?.status, `${ruleId} rule should fail`).toBe(
          'fail',
        );
      }
    },
  );

  it('negative control: all-null extracted fields surface as flood of failures', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async (): Promise<ExtractedFields> => ({
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
        }),
      }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData(
      loadApplicationJson('01-ridge-creek-bourbon'),
      makeFile('blank.jpg'),
    );
    const res = await POST(fakeRequest(fd) as never);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    if (line?.status !== 'ok') throw new Error('expected ok line');
    expect(line.report.overallStatus).toBe('needs_review');
    expect(line.report.crossCheck.overallStatus).toBe('mismatch');
    // Every regulated cross-check field should be not_on_label.
    expect(line.report.crossCheck.fields.brandName?.status).toBe('not_on_label');
    expect(line.report.crossCheck.fields.classType?.status).toBe('not_on_label');
    expect(line.report.crossCheck.fields.producer?.status).toBe('not_on_label');
    // Multiple label-only rules should fail.
    expect(line.report.fields.governmentWarning?.status).toBe('fail');
  });
});

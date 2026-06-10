import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvForTesting } from '@/lib/env';
import { resetObservabilityForTesting } from '@/lib/observability/langfuse';
import { ResultLineSchema, type ResultLine } from '@/lib/results/result-types';
import { GOVERNMENT_WARNING_CANONICAL } from '@/lib/validation/ttb-constants';
import { type ExtractedDocument } from '@/lib/extraction/types';

/**
 * Full 5-scenario truth-table integration test. Extractor + renderer are
 * mocked so the test runs deterministically in CI without an OPENAI key.
 *
 * Each scenario's `makeDocument` returns an ExtractedDocument that mirrors
 * what GPT-4o would have read from a clean form, with scenario-specific
 * intentional mismatches injected on the label half.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(): void {
  process.env.DEMO_PASSWORD = 'pw';
  process.env.DEMO_PASSWORD_COOKIE_SECRET = 'a'.repeat(32);
  process.env.LABEL_EXTRACTOR = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test';
  resetEnvForTesting();
  resetObservabilityForTesting();
}

function fakeRequest(formData: FormData): { formData: () => Promise<FormData> } {
  return { formData: async () => formData };
}

function makePdf(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'application/pdf' });
}

function buildFormData(file: File): FormData {
  const fd = new FormData();
  fd.append('pdf', file, file.name);
  return fd;
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

// --- Per-scenario ExtractedDocument fixtures ----------------------------------

function applicantOf(
  name: string,
  city: string,
  state: string,
  street = '1 Main St',
  zip = '00000',
): ExtractedDocument['application']['applicant'] {
  return {
    name,
    addressLine1: street,
    city,
    state,
    postalCode: zip,
  };
}

function withProvenance(): ExtractedDocument['provenance'] {
  // Sample provenance — just enough to assert that the route forwards bboxes
  // into the report. Real GPT-4o populates ~22 entries; one is enough here.
  return {
    'application.brandName': {
      page: 0,
      bbox: { x: 0.1, y: 0.18, w: 0.2, h: 0.03 },
      confidence: 'high',
    },
  };
}

function ridgeCreek(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'DSP-KY-20158',
      source: 'Domestic',
      serialNumber: '26-0117',
      productType: 'DISTILLED SPIRITS',
      brandName: 'Ridge Creek',
      fancifulName: 'Kentucky Straight Bourbon Whiskey',
      applicant: applicantOf('Ridge Creek Distillery, LLC', 'Bardstown', 'KY'),
      grapeVarietals: null,
      wineAppellation: null,
      applicationDate: '2026-05-22',
      applicantSignatureName: 'Margaret Hollister',
    },
    label: {
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
    },
    provenance: withProvenance(),
  };
}

function silverBirch(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'DSP-OR-12044',
      source: 'Domestic',
      serialNumber: '26-0099',
      productType: 'DISTILLED SPIRITS',
      brandName: 'Silver Birch',
      fancifulName: 'Vodka',
      applicant: applicantOf('Silver Birch Distillers Co.', 'Bend', 'OR'),
      grapeVarietals: null,
      wineAppellation: null,
      applicationDate: '2026-04-30',
      applicantSignatureName: 'Owen Marsh',
    },
    label: {
      brandName: 'Silver Birch Premium', // <-- intentional brand drift
      abv: '40% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Vodka',
      producer: 'Distilled and Bottled by Silver Birch Distillers Co. · Bend, Oregon',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    },
    provenance: withProvenance(),
  };
}

function hawthorne(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'BW-CA-4831',
      source: 'Domestic',
      serialNumber: '26-0211',
      productType: 'WINE',
      brandName: 'Hawthorne Vineyards',
      fancifulName: null,
      applicant: applicantOf('Hawthorne Cellars, Inc.', 'Healdsburg', 'CA'),
      grapeVarietals: 'Cabernet Sauvignon',
      wineAppellation: 'Napa Valley',
      applicationDate: '2026-05-01',
      applicantSignatureName: 'Elena Hawthorne',
    },
    label: {
      brandName: 'Hawthorne Vineyards',
      abv: '13.5% ALC/VOL',
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'Merlot', // <-- intentional drift
      producer: 'Produced and Bottled by Hawthorne Cellars, Inc. · Healdsburg, California',
      countryOfOrigin: 'USA',
      wineVarietal: 'Merlot', // <-- intentional drift vs Cabernet
      wineAppellation: 'Sonoma County', // <-- intentional drift vs Napa Valley
      extractionConfidence: 'high',
    },
    provenance: withProvenance(),
  };
}

function ironwood(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'BR-CO-0921',
      source: 'Domestic',
      serialNumber: '26-0044',
      productType: 'MALT BEVERAGES',
      brandName: 'Ironwood',
      fancifulName: 'India Pale Ale',
      applicant: applicantOf('Ironwood Brewing Co.', 'Denver', 'CO'),
      grapeVarietals: null,
      wineAppellation: null,
      applicationDate: '2026-04-15',
      applicantSignatureName: 'Sarah Beckett',
    },
    label: {
      brandName: 'Ironwood',
      abv: '6.8% ALC/VOL',
      governmentWarning: {
        text: null, // <-- intentional miss — drives the gov-warning rule to fail
        appearsAllCaps: null,
        appearsBold: null,
      },
      netContents: '12 FL OZ',
      classType: 'India Pale Ale',
      producer: 'Brewed by Ironwood Brewing Co. · Denver, Colorado',
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    },
    provenance: withProvenance(),
  };
}

function calypso(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'DSP-FL-3097',
      source: 'Domestic',
      serialNumber: '26-0177',
      productType: 'DISTILLED SPIRITS',
      brandName: 'Calypso',
      fancifulName: 'White Rum',
      applicant: applicantOf('Calypso Sands Distilling, Inc.', 'Miami', 'FL'),
      grapeVarietals: null,
      wineAppellation: null,
      applicationDate: '2026-05-10',
      applicantSignatureName: 'David Reyes',
    },
    label: {
      brandName: 'Calypso',
      abv: '80 PROOF', // <-- non-standard ABV format drives the ABV rule to fail
      governmentWarning: {
        text: GOVERNMENT_WARNING_CANONICAL,
        appearsAllCaps: true,
        appearsBold: true,
      },
      netContents: '750 mL',
      classType: 'White Rum',
      producer: 'Bottled by Tropical Spirits LLC, San Juan, Puerto Rico', // <-- producer mismatch
      countryOfOrigin: 'USA',
      wineVarietal: null,
      wineAppellation: null,
      extractionConfidence: 'high',
    },
    provenance: withProvenance(),
  };
}

const SCENARIOS: ReadonlyArray<{
  slug: string;
  makeDocument: () => ExtractedDocument;
  expectedVerdict: 'compliant' | 'needs_review';
  // What we expect to find in the verified report. Each predicate runs over the
  // report and returns true when the per-scenario intentional behavior shows up.
  assertOutcome(report: NonNullable<Extract<ResultLine, { status: 'ok' }>>['report']): void;
}> = [
  {
    slug: '01-ridge-creek-bourbon',
    makeDocument: ridgeCreek,
    expectedVerdict: 'compliant',
    assertOutcome(report) {
      // Clean cross-check, all rules pass — the demo's green-path scenario.
      expect(report.crossCheck.overallStatus).toBe('match');
    },
  },
  {
    slug: '02-silver-birch-vodka',
    makeDocument: silverBirch,
    expectedVerdict: 'needs_review',
    assertOutcome(report) {
      expect(report.crossCheck.overallStatus).toBe('mismatch');
      expect(report.crossCheck.fields.brandName?.status).toBe('mismatch');
    },
  },
  {
    slug: '03-hawthorne-cabernet',
    makeDocument: hawthorne,
    expectedVerdict: 'needs_review',
    assertOutcome(report) {
      expect(report.crossCheck.overallStatus).toBe('mismatch');
      expect(report.crossCheck.fields.wineVarietal?.status).toBe('mismatch');
      expect(report.crossCheck.fields.wineAppellation?.status).toBe('mismatch');
    },
  },
  {
    slug: '04-ironwood-ipa',
    makeDocument: ironwood,
    expectedVerdict: 'needs_review',
    assertOutcome(report) {
      expect(report.crossCheck.overallStatus).toBe('match');
      expect(report.fields.governmentWarning?.status).toBe('fail');
    },
  },
  {
    slug: '05-calypso-rum',
    makeDocument: calypso,
    expectedVerdict: 'needs_review',
    assertOutcome(report) {
      expect(report.crossCheck.fields.producer?.status).toBe('mismatch');
      expect(report.fields.abv?.status).toBe('fail');
    },
  },
];

describe('POST /api/verify — 5-scenario truth table (PDF pipeline)', () => {
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

  for (const scenario of SCENARIOS) {
    it(`${scenario.slug}: verdict=${scenario.expectedVerdict}`, async () => {
      const doc = scenario.makeDocument();
      vi.doMock('@/lib/extraction/factory', () => ({
        getExtractor: () => ({
          providerName: 'fake',
          extract: async () => doc,
        }),
      }));
      vi.doMock('@/lib/pdf/render', () => ({
        renderPageOne: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        PdfRenderError: class extends Error {},
      }));

      const { POST } = await import('./route');
      const fd = buildFormData(makePdf(`${scenario.slug}.pdf`));
      const res = await POST(fakeRequest(fd) as never);
      expect(res.status).toBe(200);

      const lines = await readNDJSON(res);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line?.status).toBe('ok');
      if (line?.status !== 'ok') throw new Error('expected ok line');

      expect(line.report.overallStatus).toBe(scenario.expectedVerdict);
      expect(Object.keys(line.report.provenance).length).toBeGreaterThan(0);
      scenario.assertOutcome(line.report);
    });
  }
});

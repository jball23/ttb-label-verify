import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvForTesting } from '@/lib/env';
import { resetObservabilityForTesting } from '@/lib/observability/langfuse';
import { ResultLineSchema, type ResultLine } from '@/lib/results/result-types';
import { GOVERNMENT_WARNING_CANONICAL } from '@/lib/validation/ttb-constants';
import { type ExtractedDocument } from '@/lib/extraction/types';

const ORIGINAL_ENV = { ...process.env };

function setEnv(): void {
  process.env.LABEL_EXTRACTOR = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test';
  // Default flipped to 'false' app-wide; these tests assert the bbox=on path,
  // so explicitly enable it here.
  process.env.EXTRACT_PROVENANCE = 'true';
  resetEnvForTesting();
  resetObservabilityForTesting();
}

function makePdfFile(name = 'application.pdf', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

function buildFormData(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.append('pdf', file, file.name);
  return fd;
}

function fakeRequest(formData: FormData): {
  formData: () => Promise<FormData>;
} {
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

function fakeRidgeCreekDocument(): ExtractedDocument {
  return {
    application: {
      plantRegistryNumber: 'DSP-KY-20158',
      source: 'Domestic',
      serialNumber: '26-0117',
      productType: 'DISTILLED SPIRITS',
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
      repId: null,
      mailingAddress: null,
      formula: null,
      containerWording: null,
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
    provenance: {
      'application.brandName': {
        page: 0,
        bbox: { x: 0.1, y: 0.18, w: 0.2, h: 0.03 },
        confidence: 'high',
      },
      'label.brandName': {
        page: 0,
        bbox: { x: 0.4, y: 0.85, w: 0.18, h: 0.05 },
        confidence: 'medium',
      },
    },
  };
}

function mockHappyPath(): void {
  vi.doMock('@/lib/extraction/factory', () => ({
    getExtractor: () => ({
      providerName: 'fake',
      extract: async () => fakeRidgeCreekDocument(),
    }),
  }));
  vi.doMock('@/lib/pdf/render', () => ({
    renderApplicationPages: async () => [
      {
        pageNumber: 1,
        kind: 'form+label' as const,
        png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ],
    PdfRenderError: class extends Error {},
  }));
}

describe('POST /api/verify', () => {
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

  it('returns 400 when the pdf field is missing', async () => {
    mockHappyPath();
    const { POST } = await import('./route');
    const res = await POST(fakeRequest(buildFormData(null)) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pdf/i);
  });

  it('returns 400 when the pdf field has the wrong MIME type', async () => {
    mockHappyPath();
    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('pdf', new File([new Uint8Array(8)], 'a.jpg', { type: 'image/jpeg' }));
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/application\/pdf/i);
  });

  it('returns 400 when the pdf file is empty', async () => {
    mockHappyPath();
    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('pdf', new File([new Uint8Array(0)], 'empty.pdf', { type: 'application/pdf' }));
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty/i);
  });

  it('streams one ok line with cross-check and provenance for a valid PDF', async () => {
    mockHappyPath();
    const { POST } = await import('./route');
    const res = await POST(fakeRequest(buildFormData(makePdfFile())) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/x-ndjson/);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('ok');
    if (lines[0]?.status === 'ok') {
      expect(lines[0].report.overallStatus).toBe('compliant');
      expect(lines[0].report.crossCheck?.overallStatus).toBe('match');
      expect(lines[0].report.crossCheck?.fields.brandName?.status).toBe('match');
      expect(Object.keys(lines[0].report.provenance).length).toBeGreaterThan(0);
    }
  });

  it('emits an error line when render fails', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => fakeRidgeCreekDocument(),
      }),
    }));
    vi.doMock('@/lib/pdf/render', () => {
      class PdfRenderError extends Error {
        constructor(m: string) {
          super(m);
          this.name = 'PdfRenderError';
        }
      }
      return {
        renderApplicationPages: async () => {
          throw new PdfRenderError('Could not parse PDF');
        },
        PdfRenderError,
      };
    });
    const { POST } = await import('./route');
    const res = await POST(fakeRequest(buildFormData(makePdfFile())) as never);
    expect(res.status).toBe(200);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('error');
    if (lines[0]?.status === 'error') {
      expect(lines[0].errorMessage).toMatch(/render|pdf|valid/i);
    }
  });

  it('emits an error line when the extractor throws', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => {
          throw new Error('extractor exploded');
        },
      }),
    }));
    vi.doMock('@/lib/pdf/render', () => ({
      renderApplicationPages: async () => [
      {
        pageNumber: 1,
        kind: 'form+label' as const,
        png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ],
      PdfRenderError: class extends Error {},
    }));
    const { POST } = await import('./route');
    const res = await POST(fakeRequest(buildFormData(makePdfFile())) as never);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('error');
  });

  it('serializes cache-miss verification work per server process', async () => {
    let active = 0;
    let maxActive = 0;
    vi.doMock('@/db/client', () => ({
      tryGetDb: () => null,
    }));
    vi.doMock('@/db/persist-verification', () => ({
      persistVerification: async () => null,
    }));
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        modelId: 'fake-model',
        extract: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          active -= 1;
          return fakeRidgeCreekDocument();
        },
      }),
    }));
    vi.doMock('@/lib/pdf/render', () => ({
      renderApplicationPages: async () => [
        {
          pageNumber: 1,
          kind: 'form+label' as const,
          png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      ],
      PdfRenderError: class extends Error {},
    }));

    const { POST } = await import('./route');
    const [resA, resB] = await Promise.all([
      POST(fakeRequest(buildFormData(makePdfFile('a.pdf'))) as never),
      POST(fakeRequest(buildFormData(makePdfFile('b.pdf'))) as never),
    ]);
    const [linesA, linesB] = await Promise.all([
      readNDJSON(resA),
      readNDJSON(resB),
    ]);

    expect(linesA[0]?.status).toBe('ok');
    expect(linesB[0]?.status).toBe('ok');
    expect(maxActive).toBe(1);
  });
});

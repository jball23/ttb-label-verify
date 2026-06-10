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

function makeFile(name: string, type: string, size = 256): File {
  return new File([new Uint8Array(size)], name, { type });
}

function loadFixtureApplication(slug = '01-ridge-creek-bourbon'): string {
  const file = path.join(
    process.cwd(),
    'public',
    'samples',
    'applications',
    slug,
    'application.json',
  );
  return readFileSync(file, 'utf8');
}

function buildFormData(
  files: File[],
  options: { applicationJson?: string | null } = {},
): FormData {
  const fd = new FormData();
  const applicationJson =
    options.applicationJson === undefined
      ? loadFixtureApplication()
      : options.applicationJson;
  if (applicationJson != null) {
    fd.append('application', applicationJson);
  }
  files.forEach((f, i) => fd.append(`file-${i}`, f, f.name));
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

function fakeExtractedFields(): ExtractedFields {
  // Matches the Ridge Creek bourbon application's crossCheckExpectations so the
  // happy-path test produces a `compliant` verdict end-to-end.
  return {
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

  it('returns 400 when application field is missing', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({ providerName: 'fake', extract: vi.fn() }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([makeFile('a.jpg', 'image/jpeg')], {
      applicationJson: null,
    });
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/application/i);
  });

  it('returns 400 when application JSON is malformed', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({ providerName: 'fake', extract: vi.fn() }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([makeFile('a.jpg', 'image/jpeg')], {
      applicationJson: '{not json',
    });
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/parse|json/i);
  });

  it('returns 400 when application fails Zod (bad productType)', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({ providerName: 'fake', extract: vi.fn() }),
    }));
    const { POST } = await import('./route');
    const raw = JSON.parse(loadFixtureApplication()) as {
      form: Record<string, unknown>;
    };
    raw.form.productType = 'BEER';
    const fd = buildFormData([makeFile('a.jpg', 'image/jpeg')], {
      applicationJson: JSON.stringify(raw),
    });
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/productType/i);
  });

  it('returns 400 when more than one label image is submitted with an application', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({ providerName: 'fake', extract: vi.fn() }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.jpg', 'image/jpeg'),
    ]);
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/single-label|one label/i);
  });

  it('returns 400 when no files are sent (with application)', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({ providerName: 'fake', extract: vi.fn() }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([]);
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one/i);
  });

  it('streams one ok line with crossCheck section for a valid pair', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => fakeExtractedFields(),
      }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([makeFile('a.jpg', 'image/jpeg')]);
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/x-ndjson/);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('ok');
    if (lines[0]?.status === 'ok') {
      expect(lines[0].report.overallStatus).toBe('compliant');
      expect(lines[0].report.crossCheck.overallStatus).toBe('match');
      expect(lines[0].report.crossCheck.fields.brandName?.status).toBe('match');
    }
  });

  it('returns 400 when the only file has an unsupported MIME', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => fakeExtractedFields(),
      }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([makeFile('bad.txt', 'text/plain')]);
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no valid files|unsupported|at least one/i);
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
    const { POST } = await import('./route');
    const fd = buildFormData([makeFile('a.jpg', 'image/jpeg')]);
    const res = await POST(fakeRequest(fd) as never);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('error');
  });
});

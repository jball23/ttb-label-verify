import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

function buildFormData(files: File[]): FormData {
  const fd = new FormData();
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
  return {
    brandName: 'Test Brand',
    abv: '40% ALC/VOL',
    governmentWarning: {
      text: GOVERNMENT_WARNING_CANONICAL,
      appearsAllCaps: true,
      appearsBold: true,
    },
    netContents: '750 mL',
    classType: 'BOURBON',
    producer: 'Test Co.',
    countryOfOrigin: 'USA',
    wineVarietal: null,
    wineAppellation: null,    extractionConfidence: 'high',
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

  it('returns 400 when no files are sent', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: vi.fn(),
      }),
    }));
    const { POST } = await import('./route');
    const fd = new FormData();
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one/i);
  });

  it('returns 413 when more than 25 files are sent', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: vi.fn(),
      }),
    }));
    const { POST } = await import('./route');
    const files = Array.from({ length: 26 }, (_, i) =>
      makeFile(`l-${i}.jpg`, 'image/jpeg'),
    );
    const res = await POST(fakeRequest(buildFormData(files)) as never);
    expect(res.status).toBe(413);
  });

  it('streams one ok line for a valid single-image upload', async () => {
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
    }
  });

  it('emits an error line per invalid file but keeps good ones', async () => {
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => fakeExtractedFields(),
      }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([
      makeFile('good.jpg', 'image/jpeg'),
      makeFile('bad.txt', 'text/plain'),
    ]);
    const res = await POST(fakeRequest(fd) as never);
    expect(res.status).toBe(200);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(2);
    const statuses = lines.map((l) => l.status).sort();
    expect(statuses).toEqual(['error', 'ok']);
    const err = lines.find((l) => l.status === 'error');
    if (err?.status === 'error') {
      expect(err.errorMessage).toMatch(/unsupported/i);
    }
  });

  it('emits an error line when the extractor throws — others still complete', async () => {
    let callCount = 0;
    vi.doMock('@/lib/extraction/factory', () => ({
      getExtractor: () => ({
        providerName: 'fake',
        extract: async () => {
          callCount += 1;
          if (callCount === 1) throw new Error('extractor exploded');
          return fakeExtractedFields();
        },
      }),
    }));
    const { POST } = await import('./route');
    const fd = buildFormData([
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.jpg', 'image/jpeg'),
    ]);
    const res = await POST(fakeRequest(fd) as never);
    const lines = await readNDJSON(res);
    expect(lines).toHaveLength(2);
    const errors = lines.filter((l) => l.status === 'error');
    const oks = lines.filter((l) => l.status === 'ok');
    expect(errors).toHaveLength(1);
    expect(oks).toHaveLength(1);
  });
});

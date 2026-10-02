import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseError, ReaderTimeoutError } from '@/lib/labels/errors';
import { compliantReading, FakeLabelReader } from '@/lib/labels/fake-label-reader';
import { type LabelServiceDeps } from '@/lib/labels/label-service';
import { MemoryLabelRepository } from '@/lib/labels/memory-label-repository';
import { runLabelRules } from '@/lib/labels/rules';

let deps: LabelServiceDeps;

vi.mock('@/lib/labels/server-deps', () => ({
  getLabelServiceDeps: () => deps,
  getLabelRepository: () => deps.repo,
}));

const { POST, GET } = await import('./route');
const { PATCH } = await import('./[id]/route');
const { POST: DECIDE } = await import('./[id]/decision/route');
const { GET: IMAGE } = await import('./[id]/image/route');

function upload(file: File | null, fields: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set('image', file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return POST(
    new Request('http://test/api/labels', { method: 'POST', body: form }),
    undefined,
  );
}

const jpeg = (name = 'label.jpg', bytes = 'jpeg-bytes') =>
  new File([bytes], name, { type: 'image/jpeg' });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = 'PATCH') => ({
  method,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  deps = { reader: new FakeLabelReader(), repo: new MemoryLabelRepository() };
});

describe('POST /api/labels', () => {
  it('checks an image and returns the label', async () => {
    const response = await upload(jpeg(), {
      expected: JSON.stringify({ brandName: 'Old Tom Distillery' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report.verdict).toBe('looks_good');
    expect(
      body.report.comparisons.find((c: { field: string }) => c.field === 'brandName')
        .status,
    ).toBe('match');
  });

  it.each([
    ['no image', null, {}, /No label image/],
    [
      'a PDF',
      new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }),
      {},
      /not a label photo/,
    ],
    ['an empty image', jpeg('e.jpg', ''), {}, /empty/],
    ['bad application values', jpeg(), { expected: '{nope' }, /not valid JSON/],
    [
      'an unknown application field',
      jpeg(),
      { expected: '{"colour":"red"}' },
      /expected format/,
    ],
    ['a bad batch id', jpeg(), { batchId: 'x' }, /batch id/],
  ])('rejects %s with a plain message', async (_name, file, fields, message) => {
    const response = await upload(file, fields);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
  });

  it('explains a reader timeout', async () => {
    deps.reader = new FakeLabelReader(() => {
      throw new ReaderTimeoutError();
    });
    const response = await upload(jpeg());
    expect(response.status).toBe(504);
    expect((await response.json()).error).toMatch(/took too long/);
  });

  // The old route told reviewers to check the OpenAI key when the database failed.
  it('blames the database, not the AI service, when saving fails', async () => {
    deps.repo.create = () =>
      Promise.reject(new DatabaseError(new Error('connection refused')));
    const response = await upload(jpeg());
    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).toMatch(/could not be saved/);
    expect(error).not.toMatch(/key/i);
  });
});

describe('label follow-up routes', () => {
  async function createdId() {
    return (await (await upload(jpeg())).json()).id as string;
  }

  it('re-compares application values', async () => {
    const id = await createdId();
    const response = await PATCH(
      new Request('http://test', json({ expected: { netContents: '1 L' } })),
      context(id),
    );
    expect((await response.json()).report.verdict).toBe('needs_review');
  });

  it('accepts a correction and rejects unknown fields', async () => {
    const id = await createdId();
    const ok = await PATCH(
      new Request('http://test', json({ corrections: { brandName: 'OLD TOM' } })),
      context(id),
    );
    expect((await ok.json()).report.corrections.brandName.value).toBe('OLD TOM');
    const bad = await PATCH(
      new Request('http://test', json({ corrections: { colour: 'red' } })),
      context(id),
    );
    expect(bad.status).toBe(400);
  });

  it('records a decision and lists it as decided', async () => {
    const id = await createdId();
    const response = await DECIDE(
      new Request('http://test', json({ decision: 'approved' }, 'POST')),
      context(id),
    );
    expect((await response.json()).status).toBe('approved');
    const listed = await (
      await GET(new Request('http://test/api/labels?status=decided'), undefined)
    ).json();
    expect(listed.labels.map((l: { id: string }) => l.id)).toEqual([id]);
  });

  it('serves the stored image with its type', async () => {
    const id = await createdId();
    const response = await IMAGE(new Request('http://test'), context(id));
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(await response.text()).toBe('jpeg-bytes');
  });

  it('returns 404 for an unknown label', async () => {
    const response = await IMAGE(new Request('http://test'), context('missing'));
    expect(response.status).toBe(404);
  });
});

// Sanity: the fake reader really is compliant, so verdict assertions above are meaningful.
it('uses a compliant default reading', () => {
  expect(runLabelRules(compliantReading()).every((r) => r.status === 'pass')).toBe(true);
});

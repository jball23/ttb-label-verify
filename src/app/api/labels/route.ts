import { z } from 'zod';
import { InvalidRequestError } from '@/lib/labels/errors';
import { type LabelStatus } from '@/lib/labels/label-record';
import { type LabelImageMimeType } from '@/lib/labels/label-reader';
import { checkLabel } from '@/lib/labels/label-service';
import { toLabelView } from '@/lib/labels/label-view';
import { ExpectedValuesSchema } from '@/lib/labels/reading';
import { getLabelRepository, getLabelServiceDeps } from '@/lib/labels/server-deps';
import { validateLabelFile } from '@/lib/upload/file-validation';
import { handle, parseWith } from './http';

export const runtime = 'nodejs';
// One label per request; the browser runs N of these at once.
export const maxDuration = 30;

/** Check one label image. Multipart: `image`, optional `expected` (JSON), optional `batchId`. */
export const POST = handle<unknown>(async (request) => {
  const form = await request.formData().catch(() => {
    throw new InvalidRequestError(
      'Send the label as a multipart form with an "image" field.',
    );
  });
  const image = form.get('image');
  if (!(image instanceof File))
    throw new InvalidRequestError('No label image was attached.');
  const problem = validateLabelFile(image);
  if (problem) throw new InvalidRequestError(problem);

  const expected = parseWith(
    ExpectedValuesSchema,
    parseJsonField(form.get('expected')),
    'The application values are not in the expected format.',
  );
  const batchId = parseWith(
    z.string().uuid().nullable(),
    form.get('batchId'),
    'The batch id is not valid.',
  );

  return checkLabel(getLabelServiceDeps(), {
    // validateLabelFile has confirmed the type is a supported image type.
    image: {
      bytes: Buffer.from(await image.arrayBuffer()),
      mimeType: image.type as LabelImageMimeType,
    },
    filename: image.name,
    batchId,
    expected,
  });
});

function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (value === null) return {};
  try {
    return JSON.parse(String(value));
  } catch {
    throw new InvalidRequestError('The application values are not valid JSON.');
  }
}

const STATUS_FILTERS: Record<string, readonly LabelStatus[]> = {
  to_review: ['to_review'],
  decided: ['approved', 'rejected'],
  all: ['to_review', 'approved', 'rejected'],
};

/** List labels. `?status=to_review|decided|all` (default all), newest first. */
export const GET = handle<unknown>(async (request) => {
  const status = new URL(request.url).searchParams.get('status') ?? 'all';
  const statuses = STATUS_FILTERS[status];
  if (!statuses) throw new InvalidRequestError('Unknown status filter.');
  const records = await getLabelRepository().list({ statuses, limit: 500 });
  return { labels: records.map((record) => toLabelView(record)) };
});

import { updateExpectedValues } from '@/lib/labels/label-service';
import { ExpectedValuesSchema } from '@/lib/labels/reading';
import { getLabelRepository } from '@/lib/labels/server-deps';
import { handle, parseWith, readJson } from '../../http';

export const runtime = 'nodejs';

/** Replace the application values and re-compare. No model call. */
export const PUT = handle(async (request, { params }) => {
  const expected = parseWith(
    ExpectedValuesSchema,
    await readJson(request),
    'The application values are not in the expected format.',
  );
  return updateExpectedValues({ repo: getLabelRepository() }, (await params).id, expected);
});

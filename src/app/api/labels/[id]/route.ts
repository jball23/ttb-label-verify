import { z } from 'zod';
import { CorrectionValuesSchema } from '@/lib/labels/corrections';
import { getLabel, updateReviewerValues } from '@/lib/labels/label-service';
import { ExpectedValuesSchema } from '@/lib/labels/reading';
import { getLabelRepository } from '@/lib/labels/server-deps';
import { handle, parseWith, readJson } from '../http';

export const runtime = 'nodejs';

export const GET = handle(async (_request, { params }) =>
  getLabel({ repo: getLabelRepository() }, (await params).id),
);

const ReviewerValuesSchema = z
  .object({
    expected: ExpectedValuesSchema.optional(),
    corrections: CorrectionValuesSchema.optional(),
    reviewer: z.string().max(100).nullish(),
  })
  .strict();

/** Save application values and/or corrections, and re-assess. No model call. */
export const PATCH = handle(async (request, { params }) => {
  const input = parseWith(
    ReviewerValuesSchema,
    await readJson(request),
    'The values are not in the expected format.',
  );
  return updateReviewerValues({ repo: getLabelRepository() }, (await params).id, input);
});

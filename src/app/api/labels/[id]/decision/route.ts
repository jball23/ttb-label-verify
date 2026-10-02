import { z } from 'zod';
import { decideLabel } from '@/lib/labels/label-service';
import { getLabelRepository } from '@/lib/labels/server-deps';
import { handle, parseWith, readJson } from '../../http';

export const runtime = 'nodejs';

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).nullish(),
  reviewer: z.string().max(100).nullish(),
});

/** Approve or reject a label. Rejecting requires a reason. */
export const POST = handle(async (request, { params }) => {
  const input = parseWith(DecisionSchema, await readJson(request), 'Choose Approve or Reject.');
  return decideLabel({ repo: getLabelRepository() }, (await params).id, input);
});

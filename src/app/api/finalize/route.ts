import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { finalizeApplication } from '@/db/reviews';
import { findApplicationById } from '@/db/applications';
import { tryGetDb } from '@/db/client';
import { isFinalized } from '@/db/schema';
import { scrubError } from '@/lib/safety/scrub-error';

export const runtime = 'nodejs';

const BodySchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reviewerLabel: z.string().trim().max(50).nullable().optional(),
  decisionReason: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Finalize an application — the human's terminal decision.
 *
 * The decision (approve | reject) becomes the application's `current_status`,
 * pulling it out of the home-page triage tabs and into the /applications
 * archive. A review row is appended for audit; the row itself is immutable.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!tryGetDb()) {
    return error(503, 'Database is not configured on this deployment.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, 'Malformed JSON body.');
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      400,
      `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const input = parsed.data;

  if (input.decision === 'rejected' && !input.decisionReason) {
    return error(400, 'A reason is required when the decision is to reject.');
  }

  const existing = await findApplicationById(input.applicationId);
  if (!existing) return error(404, 'Application not found.');
  if (isFinalized(existing.currentStatus)) {
    return error(
      409,
      `This application was already finalized as ${existing.currentStatus}.`,
    );
  }

  try {
    const row = await finalizeApplication({
      applicationId: input.applicationId,
      decision: input.decision,
      reviewerLabel: input.reviewerLabel ?? null,
      decisionReason: input.decisionReason ?? null,
      fieldOverrides: {},
    });
    return Response.json({ review: { id: row.id, createdAt: row.createdAt } });
  } catch (e) {
    return error(500, `Failed to finalize: ${(e as Error).message}`);
  }
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: scrubError(message) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

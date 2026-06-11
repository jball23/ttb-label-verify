import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { archiveApplications } from '@/db/applications';
import { tryGetDb } from '@/db/client';

export const runtime = 'nodejs';

const BodySchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Bulk-archive endpoint for the Finalized tab's "Archive Selected" button.
 * Sets archivedAt = now() on every supplied id that is currently finalized
 * (approved/rejected) and not yet archived. Already-archived ids and
 * pending-status ids are silently ignored — the response reports how many
 * rows actually moved.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!tryGetDb()) {
    return Response.json(
      { error: 'Database not configured.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json(
      { error: `Invalid JSON body: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    const archivedCount = await archiveApplications(parsed.data.applicationIds);
    return Response.json({ archivedCount });
  } catch (e) {
    return Response.json(
      { error: `Archive failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

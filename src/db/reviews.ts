import { eq, desc } from 'drizzle-orm';
import { getDb } from './client';
import {
  applications,
  reviews,
  type NewReview,
  type ReviewRow,
  type ReviewDecision,
} from './schema';

/**
 * Finalize an application: append an immutable review row capturing the
 * human's decision, then set the application's `current_status` to the
 * current human decision ('approved' | 'rejected'). The row stays in the
 * Finalized tab and can be revised until it is explicitly archived.
 *
 * Two sequential statements (no transaction — Neon HTTP driver doesn't
 * support multi-statement tx). If the second statement fails the review
 * row exists but the status is stale; a future finalize on the same row
 * corrects it.
 */
export async function finalizeApplication(values: NewReview): Promise<ReviewRow> {
  const db = getDb();
  const [row] = await db.insert(reviews).values(values).returning();
  if (!row) throw new Error('finalizeApplication: insert returned no rows');
  const nextStatus: ReviewDecision = row.decision;
  await db
    .update(applications)
    .set({ currentStatus: nextStatus, currentStatusAt: row.createdAt })
    .where(eq(applications.id, row.applicationId));
  return row;
}

export async function listReviewsForApplication(
  applicationId: string,
): Promise<ReviewRow[]> {
  return getDb()
    .select()
    .from(reviews)
    .where(eq(reviews.applicationId, applicationId))
    .orderBy(desc(reviews.createdAt));
}

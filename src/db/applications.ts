import { and, eq, desc, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from './client';
import {
  applications,
  type ApplicationRow,
  type CurrentStatus,
  type NewApplication,
} from './schema';

/**
 * Column projection that excludes the (potentially multi-MB) `pdfBytes`
 * column and replaces it with a `hasPdfBytes` boolean. The list view and
 * detail page never need the bytes themselves — those are streamed by
 * `/api/applications/[id]/pdf` only when the reviewer opens the modal.
 *
 * Fetching `pdfBytes` on every list query loads the entire blob into the
 * response, which (a) wastes bandwidth, (b) trips Node's `Buffer()`
 * deprecation through the Neon HTTP driver's bytea deserialization, and
 * (c) hurts the cache-by-hash path that runs on every verify.
 */
const SUMMARY_COLUMNS = {
  id: applications.id,
  createdAt: applications.createdAt,
  sourceFilename: applications.sourceFilename,
  contentHash: applications.contentHash,
  byteSize: applications.byteSize,
  promptVersion: applications.promptVersion,
  extractorModel: applications.extractorModel,
  latencyMs: applications.latencyMs,
  extractedForm: applications.extractedForm,
  extractedLabel: applications.extractedLabel,
  validationReport: applications.validationReport,
  aiVerdict: applications.aiVerdict,
  currentStatus: applications.currentStatus,
  currentStatusAt: applications.currentStatusAt,
  brandName: applications.brandName,
  applicantName: applications.applicantName,
  ttbSerialNumber: applications.ttbSerialNumber,
  archivedAt: applications.archivedAt,
  hasPdfBytes: sql<boolean>`${applications.pdfBytes} is not null`.as('has_pdf_bytes'),
} as const;

export type ApplicationSummary = Omit<ApplicationRow, 'pdfBytes'> & {
  hasPdfBytes: boolean;
};

export async function insertApplication(
  values: NewApplication,
): Promise<ApplicationRow> {
  const [row] = await getDb().insert(applications).values(values).returning();
  if (!row) throw new Error('insertApplication: insert returned no rows');
  return row;
}

export async function findApplicationById(
  id: string,
): Promise<ApplicationSummary | null> {
  const rows = await getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findApplicationByHash(
  contentHash: string,
): Promise<ApplicationSummary | null> {
  const rows = await getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .where(eq(applications.contentHash, contentHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function listApplications(
  limit = 50,
): Promise<ApplicationSummary[]> {
  return getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .orderBy(desc(applications.createdAt))
    .limit(limit);
}

/**
 * @param archived `false` (default) = only non-archived rows; `true` = only
 * archived rows; `'any'` = both. The queue tabs always pass `false` (the
 * /applications archive page passes `true`).
 */
export async function listApplicationsByStatus(
  statuses: CurrentStatus[],
  limit = 100,
  archived: boolean | 'any' = false,
): Promise<ApplicationSummary[]> {
  if (statuses.length === 0) return [];
  const statusFilter = inArray(applications.currentStatus, statuses);
  const archivedFilter =
    archived === 'any'
      ? undefined
      : archived
        ? isNotNull(applications.archivedAt)
        : isNull(applications.archivedAt);
  return getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .where(archivedFilter ? and(statusFilter, archivedFilter) : statusFilter)
    .orderBy(desc(applications.createdAt))
    .limit(limit);
}

/**
 * Rows finalized (approved or rejected) by a reviewer but not yet archived.
 * These live in the Queue's "Finalized" tab until the reviewer batch-archives
 * them via Archive Selected.
 */
export async function listFinalizedNotArchived(
  limit = 100,
): Promise<ApplicationSummary[]> {
  return getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .where(
      and(
        inArray(applications.currentStatus, ['approved', 'rejected']),
        isNull(applications.archivedAt),
      ),
    )
    .orderBy(desc(applications.currentStatusAt))
    .limit(limit);
}

/**
 * Bulk-archive — sets archivedAt = now() on every row in `ids`. Used by the
 * Archive Selected button in the Finalized tab. Returns the count of rows
 * actually updated (excludes already-archived ids).
 */
export async function archiveApplications(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await getDb()
    .update(applications)
    .set({ archivedAt: new Date() })
    .where(
      and(
        inArray(applications.id, ids),
        isNull(applications.archivedAt),
        inArray(applications.currentStatus, ['approved', 'rejected']),
      ),
    )
    .returning({ id: applications.id });
  return result.length;
}

export interface QueueCounts {
  pending_approval: number;
  pending_rejection: number;
  finalized: number;
}

/**
 * Counts for the queue tabs. Approved/Rejected are pending-finalize rows;
 * Finalized is the new in-between state (approved/rejected with archivedAt
 * still NULL). Archived rows aren't counted — they live in /applications.
 */
export async function countByQueueBucket(): Promise<QueueCounts> {
  const rows = await getDb()
    .select({
      status: applications.currentStatus,
      isFinalNotArchived: sql<boolean>`(${applications.currentStatus} in ('approved','rejected') and ${applications.archivedAt} is null)`.as(
        'is_final_not_archived',
      ),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(applications)
    .where(isNull(applications.archivedAt))
    .groupBy(
      applications.currentStatus,
      sql`(${applications.currentStatus} in ('approved','rejected') and ${applications.archivedAt} is null)`,
    );

  const out: QueueCounts = {
    pending_approval: 0,
    pending_rejection: 0,
    finalized: 0,
  };
  for (const row of rows) {
    if (row.status === 'pending_approval') out.pending_approval = row.count;
    else if (row.status === 'pending_rejection') out.pending_rejection = row.count;
    else if (row.isFinalNotArchived) out.finalized += row.count;
  }
  return out;
}

// Re-export so callers don't have to import from both files.
export type { SQL };

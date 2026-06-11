import { eq, desc, inArray, sql, type SQL } from 'drizzle-orm';
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

export async function listApplicationsByStatus(
  statuses: CurrentStatus[],
  limit = 100,
): Promise<ApplicationSummary[]> {
  if (statuses.length === 0) return [];
  return getDb()
    .select(SUMMARY_COLUMNS)
    .from(applications)
    .where(inArray(applications.currentStatus, statuses))
    .orderBy(desc(applications.createdAt))
    .limit(limit);
}

export async function countByStatus(): Promise<Record<CurrentStatus, number>> {
  const rows = await getDb()
    .select({
      status: applications.currentStatus,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(applications)
    .groupBy(applications.currentStatus);

  const counts: Record<CurrentStatus, number> = {
    pending_approval: 0,
    pending_rejection: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of rows) {
    counts[row.status as CurrentStatus] = row.count;
  }
  return counts;
}

// Re-export so callers don't have to import from both files.
export type { SQL };

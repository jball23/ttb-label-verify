import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
  customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});
import { sql } from 'drizzle-orm';
import type { ExtractedDocument } from '@/lib/extraction/types';
import type { VerificationReport } from '@/lib/validation/types';

export type AiVerdict = 'compliant' | 'needs_review' | 'non_compliant';

/**
 * Lifecycle of a verified COLA submission:
 *   • 'pending_approval'  — AI judged compliant; awaiting human Finalize.
 *   • 'pending_rejection' — AI judged non-compliant; awaiting human Finalize.
 *   • 'approved'          — human finalized as approved; remains in the
 *                           Finalized queue until archivedAt is set.
 *   • 'rejected'          — human finalized as rejected; remains in the
 *                           Finalized queue until archivedAt is set.
 *
 * Items don't persist in a 'queued'/'processing' state — those only exist
 * client-side during the in-flight verify API call.
 */
export type CurrentStatus =
  | 'pending_approval'
  | 'pending_rejection'
  | 'approved'
  | 'rejected';
export type ReviewDecision = 'approved' | 'rejected';

export function aiVerdictToInitialStatus(verdict: AiVerdict): CurrentStatus {
  // Only a *non_compliant* verdict routes to pending_rejection. `needs_review`
  // means "look at it, but it's probably fine" — TTB approves plenty of these
  // — so it shares the pending_approval queue. The reviewer can still flip
  // the decision in the Finalize form.
  return verdict === 'non_compliant' ? 'pending_rejection' : 'pending_approval';
}

export function isFinalized(status: CurrentStatus): boolean {
  return status === 'approved' || status === 'rejected';
}

export const applications = pgTable(
  'applications',
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // Input identity
    sourceFilename: text().notNull(),
    contentHash: text().notNull(),
    byteSize: integer().notNull(),

    // AI run metadata — every row is reproducible to a specific prompt + model
    promptVersion: text().notNull(),
    extractorModel: text().notNull(),
    latencyMs: integer().notNull(),

    // Full-fidelity AI output (immutable after insert)
    extractedForm: jsonb().$type<ExtractedDocument['application']>().notNull(),
    extractedLabel: jsonb().$type<ExtractedDocument['label']>().notNull(),
    validationReport: jsonb().$type<VerificationReport>().notNull(),
    aiVerdict: text().$type<AiVerdict>().notNull(),

    // Denormalized current state. Source of truth is `reviews`;
    // the app layer writes this when a review is inserted so list views
    // are a single-table query.
    currentStatus: text()
      .$type<CurrentStatus>()
      .notNull()
      .default('pending_approval'),
    currentStatusAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // Searchable convenience columns (extracted once, indexed)
    brandName: text(),
    applicantName: text(),
    ttbSerialNumber: text(),

    // Original PDF bytes — nullable for backwards-compat with rows inserted
    // before this column existed. Reviewers open the PDF via a modal on the
    // detail page. Production path: move to object storage (Vercel Blob /
    // Azure Blob inside FedRAMP boundary) and store a URL here instead.
    pdfBytes: bytea('pdf_bytes'),

    // Set when a reviewer moves a finalized row from the Finalized tab to
    // the /applications archive via the Archive Selected button. Finalize
    // (approve/reject) does not auto-archive; items stay in the Finalized
    // queue and can still be revised until this timestamp is set.
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('applications_created_at_idx').on(t.createdAt.desc()),
    index('applications_current_status_idx').on(t.currentStatus),
    index('applications_content_hash_idx').on(t.contentHash),
    index('applications_brand_name_idx').on(sql`lower(${t.brandName})`),
    index('applications_ttb_serial_idx').on(t.ttbSerialNumber),
    index('applications_archived_at_idx').on(t.archivedAt),
    check(
      'applications_ai_verdict_check',
      sql`${t.aiVerdict} in ('compliant','needs_review','non_compliant')`,
    ),
    check(
      'applications_current_status_check',
      sql`${t.currentStatus} in ('pending_approval','pending_rejection','approved','rejected')`,
    ),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // Free-text identifier — slots in for reviewer_id when users land
    reviewerLabel: text(),
    decision: text().$type<ReviewDecision>().notNull(),
    decisionReason: text(),

    // Sparse map of rule/field overrides:
    //   { governmentWarning: "accept — printing variant", brand: "..." }
    fieldOverrides: jsonb()
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('reviews_application_id_idx').on(t.applicationId, t.createdAt.desc()),
    check(
      'reviews_decision_check',
      sql`${t.decision} in ('approved','rejected')`,
    ),
  ],
);

export const promptVersions = pgTable('prompt_versions', {
  version: text().primaryKey(),
  introducedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  notes: text(),
});

export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ReviewRow = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

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
import type { LabelImageMimeType } from '@/lib/labels/label-reader';
import type { Corrections } from '@/lib/labels/corrections';
import type { ExpectedValues, LabelReading } from '@/lib/labels/reading';
import type { LabelDecision, LabelStatus } from '@/lib/labels/label-record';
import type { Verdict } from '@/lib/labels/verdict';

/**
 * One checked label image. The reading is the model's output, never edited;
 * the reviewer's corrections and expected values are stored beside it. The
 * report (rules, comparisons) is recomputed from those on read, so only the
 * derived verdict is stored, for filtering.
 */
export const labels = pgTable(
  'labels',
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    batchId: uuid(),
    filename: text().notNull(),
    mimeType: text().$type<LabelImageMimeType>().notNull(),
    byteSize: integer().notNull(),
    contentHash: text().notNull(),
    imageBytes: bytea().notNull(),
    readerModel: text().notNull(),
    promptVersion: text().notNull(),
    latencyMs: integer().notNull(),
    reading: jsonb().$type<LabelReading>().notNull(),
    expected: jsonb().$type<ExpectedValues>().notNull().default({}),
    corrections: jsonb().$type<Corrections>().notNull().default({}),
    verdict: text().$type<Verdict>().notNull(),
    status: text().$type<LabelStatus>().notNull().default('to_review'),
    statusAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('labels_created_at_idx').on(t.createdAt.desc()),
    index('labels_status_idx').on(t.status, t.createdAt.desc()),
    index('labels_reading_cache_idx').on(t.contentHash, t.promptVersion, t.readerModel),
    check(
      'labels_verdict_check',
      sql`${t.verdict} in ('looks_good','needs_review','problems_found')`,
    ),
    check('labels_status_check', sql`${t.status} in ('to_review','approved','rejected')`),
  ],
);

export const labelDecisions = pgTable(
  'label_decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewer: text(),
    decision: text().$type<LabelDecision>().notNull(),
    reason: text(),
  },
  (t) => [
    index('label_decisions_label_id_idx').on(t.labelId, t.createdAt.desc()),
    check(
      'label_decisions_decision_check',
      sql`${t.decision} in ('approved','rejected')`,
    ),
  ],
);

export type LabelRow = typeof labels.$inferSelect;
export type NewLabelRow = typeof labels.$inferInsert;
export type LabelDecisionRow = typeof labelDecisions.$inferSelect;

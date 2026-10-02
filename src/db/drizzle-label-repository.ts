import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { DatabaseError } from '@/lib/labels/errors';
import { type LabelImage } from '@/lib/labels/label-reader';
import {
  type DecisionRecord,
  type LabelRecord,
  type LabelRepository,
  type LabelStatus,
  type NewDecision,
  type NewLabelRecord,
} from '@/lib/labels/label-record';
import { type ExpectedValues, type LabelReading } from '@/lib/labels/reading';
import { type Verdict } from '@/lib/labels/verdict';
import { type Database } from './client';
import { labelDecisions, labels } from './schema';

// Every column except the image, which is only read by getImage().
const { imageBytes: _imageBytes, ...RECORD_COLUMNS } = getTableColumns(labels);

export class DrizzleLabelRepository implements LabelRepository {
  constructor(private readonly db: Database) {}

  create(label: NewLabelRecord): Promise<LabelRecord> {
    return this.run(async () => {
      const [row] = await this.db.insert(labels).values(label).returning(RECORD_COLUMNS);
      if (!row) throw new Error('insert returned no row');
      return row;
    });
  }

  get(id: string): Promise<LabelRecord | null> {
    return this.run(async () => {
      const [row] = await this.db.select(RECORD_COLUMNS).from(labels).where(eq(labels.id, id));
      return row ?? null;
    });
  }

  getImage(id: string): Promise<LabelImage | null> {
    return this.run(async () => {
      const [row] = await this.db
        .select({ bytes: labels.imageBytes, mimeType: labels.mimeType })
        .from(labels)
        .where(eq(labels.id, id));
      return row ?? null;
    });
  }

  findCachedReading(contentHash: string, promptVersion: string, readerModel: string): Promise<LabelReading | null> {
    return this.run(async () => {
      const [row] = await this.db
        .select({ reading: labels.reading })
        .from(labels)
        .where(
          and(
            eq(labels.contentHash, contentHash),
            eq(labels.promptVersion, promptVersion),
            eq(labels.readerModel, readerModel),
          ),
        )
        .orderBy(desc(labels.createdAt))
        .limit(1);
      return row?.reading ?? null;
    });
  }

  updateExpected(id: string, expected: ExpectedValues, verdict: Verdict): Promise<LabelRecord | null> {
    return this.run(async () => {
      const [row] = await this.db
        .update(labels)
        .set({ expected, verdict })
        .where(eq(labels.id, id))
        .returning(RECORD_COLUMNS);
      return row ?? null;
    });
  }

  recordDecision(id: string, decision: NewDecision): Promise<LabelRecord | null> {
    return this.run(async () => {
      const now = new Date();
      // The Neon HTTP driver runs a batch as a single transaction.
      const [, updated] = await this.db.batch([
        this.db.insert(labelDecisions).values({ ...decision, labelId: id, createdAt: now }),
        this.db
          .update(labels)
          .set({ status: decision.decision, statusAt: now })
          .where(eq(labels.id, id))
          .returning(RECORD_COLUMNS),
      ]);
      return updated[0] ?? null;
    });
  }

  listDecisions(id: string): Promise<DecisionRecord[]> {
    return this.run(() =>
      this.db
        .select({
          id: labelDecisions.id,
          createdAt: labelDecisions.createdAt,
          reviewer: labelDecisions.reviewer,
          decision: labelDecisions.decision,
          reason: labelDecisions.reason,
        })
        .from(labelDecisions)
        .where(eq(labelDecisions.labelId, id))
        .orderBy(desc(labelDecisions.createdAt)),
    );
  }

  list({ statuses, limit }: { statuses: readonly LabelStatus[]; limit: number }): Promise<LabelRecord[]> {
    return this.run(() =>
      this.db
        .select(RECORD_COLUMNS)
        .from(labels)
        .where(inArray(labels.status, [...statuses]))
        .orderBy(desc(labels.createdAt))
        .limit(limit),
    );
  }

  /** Every database failure surfaces as a DatabaseError with a plain message. */
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw new DatabaseError(error);
    }
  }
}

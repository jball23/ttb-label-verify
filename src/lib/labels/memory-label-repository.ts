import { randomUUID } from 'node:crypto';
import { type LabelImage } from './label-reader';
import {
  type DecisionRecord,
  type LabelRecord,
  type LabelRepository,
  type NewDecision,
  type NewLabelRecord,
  type ReviewerUpdate,
} from './label-record';
import { type LabelReading } from './reading';

/**
 * Process-local storage, used when no DATABASE_URL is configured (local
 * demos) and in tests. Nothing survives a restart.
 */
export class MemoryLabelRepository implements LabelRepository {
  private readonly labels = new Map<string, { record: LabelRecord; image: LabelImage }>();
  private readonly decisions = new Map<string, DecisionRecord[]>();

  async create({ imageBytes, ...label }: NewLabelRecord): Promise<LabelRecord> {
    const now = new Date();
    const record: LabelRecord = {
      ...label,
      id: randomUUID(),
      createdAt: now,
      status: 'to_review',
      statusAt: now,
    };
    this.labels.set(record.id, {
      record,
      image: { bytes: imageBytes, mimeType: label.mimeType },
    });
    return record;
  }

  async get(id: string): Promise<LabelRecord | null> {
    return this.labels.get(id)?.record ?? null;
  }

  async getImage(id: string): Promise<LabelImage | null> {
    return this.labels.get(id)?.image ?? null;
  }

  async findCachedReading(
    contentHash: string,
    promptVersion: string,
    readerModel: string,
  ): Promise<LabelReading | null> {
    for (const { record } of this.labels.values()) {
      if (
        record.contentHash === contentHash &&
        record.promptVersion === promptVersion &&
        record.readerModel === readerModel
      ) {
        return record.reading;
      }
    }
    return null;
  }

  async updateReviewerInput(
    id: string,
    update: ReviewerUpdate,
  ): Promise<LabelRecord | null> {
    return this.patch(id, update);
  }

  async recordDecision(id: string, decision: NewDecision): Promise<LabelRecord | null> {
    if (!this.labels.has(id)) return null;
    const row: DecisionRecord = { ...decision, id: randomUUID(), createdAt: new Date() };
    this.decisions.set(id, [row, ...(this.decisions.get(id) ?? [])]);
    return this.patch(id, { status: decision.decision, statusAt: row.createdAt });
  }

  async listDecisions(id: string): Promise<DecisionRecord[]> {
    return this.decisions.get(id) ?? [];
  }

  async listDecisionsFor(ids: readonly string[]): Promise<Map<string, DecisionRecord[]>> {
    return new Map(ids.map((id) => [id, this.decisions.get(id) ?? []]));
  }

  async list({
    statuses,
    limit,
  }: {
    statuses: readonly LabelRecord['status'][];
    limit: number;
  }): Promise<LabelRecord[]> {
    return [...this.labels.values()]
      .map(({ record }) => record)
      .filter((record) => statuses.includes(record.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private patch(id: string, changes: Partial<LabelRecord>): LabelRecord | null {
    const entry = this.labels.get(id);
    if (!entry) return null;
    entry.record = { ...entry.record, ...changes };
    return entry.record;
  }
}

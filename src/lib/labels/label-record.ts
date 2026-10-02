import { type LabelImage, type LabelImageMimeType } from './label-reader';
import { type ExpectedValues, type LabelReading } from './reading';
import { type Verdict } from './verdict';

/** to_review until a person approves or rejects the label. */
export type LabelStatus = 'to_review' | 'approved' | 'rejected';
export type LabelDecision = Exclude<LabelStatus, 'to_review'>;

export interface DecisionRecord {
  id: string;
  createdAt: Date;
  reviewer: string | null;
  decision: LabelDecision;
  reason: string | null;
}

export interface LabelRecord {
  id: string;
  createdAt: Date;
  batchId: string | null;
  filename: string;
  mimeType: LabelImageMimeType;
  byteSize: number;
  contentHash: string;
  readerModel: string;
  promptVersion: string;
  latencyMs: number;
  reading: LabelReading;
  expected: ExpectedValues;
  verdict: Verdict;
  status: LabelStatus;
  statusAt: Date;
}

export type NewLabelRecord = Omit<LabelRecord, 'id' | 'createdAt' | 'status' | 'statusAt'> & {
  imageBytes: Buffer;
};

export interface NewDecision {
  decision: LabelDecision;
  reason: string | null;
  reviewer: string | null;
}

/** Storage for checked labels. Callers never see the database. */
export interface LabelRepository {
  create(label: NewLabelRecord): Promise<LabelRecord>;
  get(id: string): Promise<LabelRecord | null>;
  getImage(id: string): Promise<LabelImage | null>;
  /** A reading of the same image under the same prompt and model, if one exists. */
  findCachedReading(contentHash: string, promptVersion: string, readerModel: string): Promise<LabelReading | null>;
  updateExpected(id: string, expected: ExpectedValues, verdict: Verdict): Promise<LabelRecord | null>;
  /** Records the decision and moves the label to that status, atomically. */
  recordDecision(id: string, decision: NewDecision): Promise<LabelRecord | null>;
  listDecisions(id: string): Promise<DecisionRecord[]>;
  list(filter: { statuses: readonly LabelStatus[]; limit: number }): Promise<LabelRecord[]>;
}

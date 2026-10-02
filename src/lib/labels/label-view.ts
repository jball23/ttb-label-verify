import { type DecisionRecord, type LabelRecord, type LabelStatus } from './label-record';
import { assessReading, type LabelReport } from './verify-label';

/** The JSON shape the API returns and the UI renders. */
export interface LabelView {
  id: string;
  createdAt: string;
  batchId: string | null;
  filename: string;
  imageUrl: string;
  latencyMs: number;
  readerModel: string;
  status: LabelStatus;
  statusAt: string;
  report: LabelReport;
  decisions: Array<Omit<DecisionRecord, 'createdAt'> & { createdAt: string }>;
}

export function toLabelView(record: LabelRecord, decisions: DecisionRecord[] = []): LabelView {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    batchId: record.batchId,
    filename: record.filename,
    imageUrl: `/api/labels/${record.id}/image`,
    latencyMs: record.latencyMs,
    readerModel: record.readerModel,
    status: record.status,
    statusAt: record.statusAt.toISOString(),
    // Recomputed from the stored reading so a rule change applies everywhere.
    report: assessReading(record.reading, { expected: record.expected, corrections: record.corrections }),
    decisions: decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
  };
}

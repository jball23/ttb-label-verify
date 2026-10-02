import { createHash } from 'node:crypto';
import { reconcileCorrections, type CorrectionValues } from './corrections';
import { InvalidRequestError, LabelNotFoundError } from './errors';
import { type LabelImage, type LabelReader } from './label-reader';
import {
  type DecisionRecord,
  type LabelDecision,
  type LabelRecord,
  type LabelRepository,
} from './label-record';
import { toLabelView, type LabelView } from './label-view';
import { PROMPT_VERSION } from './prompt';
import { type ExpectedValues } from './reading';
import { assessReading } from './verify-label';

export interface LabelServiceDeps {
  reader: LabelReader;
  repo: LabelRepository;
}

export interface CheckLabelInput {
  image: LabelImage;
  filename: string;
  batchId?: string | null;
  expected?: ExpectedValues;
}

/**
 * Read (or reuse a cached reading of) one label image, assess it and store
 * the result.
 */
export async function checkLabel(
  { reader, repo }: LabelServiceDeps,
  { image, filename, batchId = null, expected = {} }: CheckLabelInput,
): Promise<LabelView> {
  const started = Date.now();
  const contentHash = createHash('sha256').update(image.bytes).digest('hex');
  const reading =
    (await repo.findCachedReading(contentHash, PROMPT_VERSION, reader.modelId)) ??
    (await reader.read(image));
  const report = assessReading(reading, { expected });

  const record = await repo.create({
    batchId,
    filename,
    mimeType: image.mimeType,
    byteSize: image.bytes.byteLength,
    contentHash,
    imageBytes: image.bytes,
    readerModel: reader.modelId,
    promptVersion: PROMPT_VERSION,
    latencyMs: Date.now() - started,
    reading,
    expected,
    corrections: {},
    verdict: report.verdict,
  });
  return toLabelView(record);
}

export async function getLabel({ repo }: Pick<LabelServiceDeps, 'repo'>, id: string): Promise<LabelView> {
  const [record, decisions] = await Promise.all([repo.get(id), repo.listDecisions(id)]);
  return toLabelView(found(record), decisions);
}

export interface ReviewerValuesInput {
  /** Replaces the application values when present. */
  expected?: ExpectedValues;
  /** The full set of corrected label values when present; omitted fields are uncorrected. */
  corrections?: CorrectionValues;
  reviewer?: string | null;
}

/**
 * Save the reviewer's application values and/or corrections and re-assess.
 * No model call — the stored reading is reused, so this is instant.
 */
export async function updateReviewerValues(
  { repo }: Pick<LabelServiceDeps, 'repo'>,
  id: string,
  input: ReviewerValuesInput,
  now: Date = new Date(),
): Promise<LabelView> {
  const record = found(await repo.get(id));
  const expected = input.expected ?? record.expected;
  const corrections = input.corrections
    ? reconcileCorrections(record.reading, record.corrections, input.corrections, {
        at: now,
        reviewer: input.reviewer?.trim() || null,
      })
    : record.corrections;
  const { verdict } = assessReading(record.reading, { expected, corrections });
  return withDecisions(repo, found(await repo.updateReviewerInput(id, { expected, corrections, verdict })));
}

export async function decideLabel(
  { repo }: Pick<LabelServiceDeps, 'repo'>,
  id: string,
  input: { decision: LabelDecision; reason?: string | null; reviewer?: string | null },
): Promise<LabelView> {
  const reason = input.reason?.trim() || null;
  if (input.decision === 'rejected' && !reason) {
    throw new InvalidRequestError('Please say why this label is being rejected.');
  }
  const record = await repo.recordDecision(id, {
    decision: input.decision,
    reason,
    reviewer: input.reviewer?.trim() || null,
  });
  return withDecisions(repo, found(record));
}

async function withDecisions(repo: LabelRepository, record: LabelRecord): Promise<LabelView> {
  const decisions: DecisionRecord[] = await repo.listDecisions(record.id);
  return toLabelView(record, decisions);
}

function found(record: LabelRecord | null): LabelRecord {
  if (!record) throw new LabelNotFoundError();
  return record;
}

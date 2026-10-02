import { createHash } from 'node:crypto';
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
  const report = assessReading(reading, expected);

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
    verdict: report.verdict,
  });
  return toLabelView(record);
}

export async function getLabel({ repo }: Pick<LabelServiceDeps, 'repo'>, id: string): Promise<LabelView> {
  const [record, decisions] = await Promise.all([repo.get(id), repo.listDecisions(id)]);
  return toLabelView(found(record), decisions);
}

/** Re-compare against new application values. No model call — instant. */
export async function updateExpectedValues(
  { repo }: Pick<LabelServiceDeps, 'repo'>,
  id: string,
  expected: ExpectedValues,
): Promise<LabelView> {
  const record = found(await repo.get(id));
  const { verdict } = assessReading(record.reading, expected);
  return withDecisions(repo, found(await repo.updateExpected(id, expected, verdict)));
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

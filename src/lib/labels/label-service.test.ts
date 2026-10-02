import { describe, expect, it } from 'vitest';
import { InvalidRequestError, LabelNotFoundError } from './errors';
import { compliantReading, FakeLabelReader } from './fake-label-reader';
import { type LabelImage } from './label-reader';
import { checkLabel, decideLabel, getLabel, updateExpectedValues } from './label-service';
import { MemoryLabelRepository } from './memory-label-repository';

const image: LabelImage = { bytes: Buffer.from('label-a'), mimeType: 'image/jpeg' };

function setup() {
  let reads = 0;
  const reader = new FakeLabelReader(() => {
    reads += 1;
    return compliantReading();
  });
  const deps = { reader, repo: new MemoryLabelRepository() };
  return { deps, reads: () => reads };
}

describe('label service', () => {
  it('checks, stores and returns a label', async () => {
    const { deps } = setup();
    const view = await checkLabel(deps, { image, filename: 'old-tom.jpg' });
    expect(view.filename).toBe('old-tom.jpg');
    expect(view.status).toBe('to_review');
    expect(view.report.verdict).toBe('looks_good');
    expect(view.imageUrl).toBe(`/api/labels/${view.id}/image`);
    await expect(deps.repo.getImage(view.id)).resolves.toEqual(image);
  });

  it('reuses the reading of an identical image instead of calling the reader again', async () => {
    const { deps, reads } = setup();
    await checkLabel(deps, { image, filename: 'a.jpg' });
    await checkLabel(deps, { image: { ...image, bytes: Buffer.from('label-a') }, filename: 'a-again.jpg' });
    await checkLabel(deps, { image: { ...image, bytes: Buffer.from('label-b') }, filename: 'b.jpg' });
    expect(reads()).toBe(2);
  });

  it('re-compares new application values without reading the image again', async () => {
    const { deps, reads } = setup();
    const { id } = await checkLabel(deps, { image, filename: 'a.jpg' });
    const updated = await updateExpectedValues(deps, id, { alcoholContent: '40%' });
    expect(reads()).toBe(1);
    expect(updated.report.verdict).toBe('needs_review');
    expect((await getLabel(deps, id)).report.expected).toEqual({ alcoholContent: '40%' });
  });

  it('records decisions, and requires a reason to reject', async () => {
    const { deps } = setup();
    const { id } = await checkLabel(deps, { image, filename: 'a.jpg' });
    await expect(decideLabel(deps, id, { decision: 'rejected', reason: '  ' })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    const view = await decideLabel(deps, id, { decision: 'rejected', reason: 'Warning in title case', reviewer: 'JP' });
    expect(view.status).toBe('rejected');
    expect(view.decisions).toMatchObject([{ decision: 'rejected', reason: 'Warning in title case', reviewer: 'JP' }]);
  });

  it('reports a missing label as not found', async () => {
    const { deps } = setup();
    await expect(getLabel(deps, 'nope')).rejects.toBeInstanceOf(LabelNotFoundError);
    await expect(updateExpectedValues(deps, 'nope', {})).rejects.toBeInstanceOf(LabelNotFoundError);
    await expect(decideLabel(deps, 'nope', { decision: 'approved' })).rejects.toBeInstanceOf(LabelNotFoundError);
  });
});

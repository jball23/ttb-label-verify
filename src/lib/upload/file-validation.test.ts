import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_SIZE,
  MAX_FILE_BYTES,
  partitionLabelFiles,
  validateLabelFile,
} from './file-validation';

const file = (type: string, size = 1024) => ({ type, size });

describe('validateLabelFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validateLabelFile(file(type))).toBeNull();
  });

  it('rejects PDFs and other types', () => {
    expect(validateLabelFile(file('application/pdf'))).toMatch(/not a label photo/);
    expect(validateLabelFile(file(''))).toMatch(/not a label photo/);
  });

  it('rejects empty and oversized images', () => {
    expect(validateLabelFile(file('image/jpeg', 0))).toMatch(/empty/);
    expect(validateLabelFile(file('image/jpeg', MAX_FILE_BYTES + 1))).toMatch(
      /larger than/,
    );
  });
});

describe('partitionLabelFiles', () => {
  it('keeps good files and explains each rejected one', () => {
    const good = file('image/jpeg');
    const bad = file('application/pdf');
    const { accepted, rejected } = partitionLabelFiles([good, bad]);
    expect(accepted).toEqual([good]);
    expect(rejected).toEqual([
      { file: bad, reason: expect.stringMatching(/not a label photo/) },
    ]);
  });

  it('rejects files beyond the batch limit', () => {
    const files = Array.from({ length: MAX_BATCH_SIZE + 2 }, () => file('image/jpeg'));
    const { accepted, rejected } = partitionLabelFiles(files);
    expect(accepted).toHaveLength(MAX_BATCH_SIZE);
    expect(rejected).toHaveLength(2);
  });
});

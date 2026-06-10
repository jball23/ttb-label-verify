import { describe, it, expect } from 'vitest';
import { validateBatch, MAX_BATCH_SIZE } from './file-validation';

function makeFile(
  name: string,
  type: string,
  size: number = 1024,
): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('validateBatch', () => {
  it('rejects empty input', () => {
    const result = validateBatch([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least one/i);
  });

  it(`rejects more than ${MAX_BATCH_SIZE} files`, () => {
    const files = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) =>
      makeFile(`l-${i}.jpg`, 'image/jpeg'),
    );
    const result = validateBatch(files);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(new RegExp(`Maximum ${MAX_BATCH_SIZE}`));
  });

  it('accepts a single valid image', () => {
    const result = validateBatch([makeFile('a.jpg', 'image/jpeg')]);
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('accepts mixed valid types', () => {
    const result = validateBatch([
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.png', 'image/png'),
      makeFile('c.webp', 'image/webp'),
      makeFile('d.pdf', 'application/pdf'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(4);
  });

  it('partial-accepts when some files are invalid', () => {
    const result = validateBatch([
      makeFile('good.jpg', 'image/jpeg'),
      makeFile('bad.txt', 'text/plain'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/unsupported file type/i);
  });

  it('rejects a file over 10 MB with a clear reason', () => {
    const oversized = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024);
    const result = validateBatch([oversized]);
    expect(result.ok).toBe(false); // single file, all rejected, batch invalid
    expect(result.rejected[0]?.reason).toMatch(/10 MB limit/i);
  });

  it('returns ok=false when all files are rejected', () => {
    const result = validateBatch([makeFile('bad.txt', 'text/plain')]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no valid files/i);
  });
});

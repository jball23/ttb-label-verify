import { describe, it, expect } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1500, '1.5 KB'],
    [2_500_000, '2.4 MB'],
    [10 * 1024 * 1024, '10.0 MB'],
    [3 * 1024 * 1024 * 1024, '3.0 GB'],
  ])('formats %d bytes as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('handles negative + non-finite values gracefully', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });
});

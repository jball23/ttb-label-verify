import { describe, it, expect } from 'vitest';
import { diffWarning, type DiffSegment } from './warning-diff';

function reconstructExtracted(segments: DiffSegment[]): string {
  return segments
    .filter((s) => s.kind === 'equal' || s.kind === 'extra')
    .map((s) => s.text)
    .join('');
}

function reconstructCanonical(segments: DiffSegment[]): string {
  return segments
    .filter((s) => s.kind === 'equal' || s.kind === 'missing')
    .map((s) => s.text)
    .join('');
}

const CANONICAL =
  'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.';

describe('diffWarning', () => {
  it('returns a single equal segment when texts match exactly', () => {
    const result = diffWarning(CANONICAL, CANONICAL);
    expect(result).toEqual([{ kind: 'equal', text: CANONICAL }]);
  });

  it('returns missing prefix segment when prefix is dropped', () => {
    const withoutPrefix = CANONICAL.replace('GOVERNMENT WARNING: ', '');
    const result = diffWarning(CANONICAL, withoutPrefix);
    expect(result[0]?.kind).toBe('missing');
    expect(result[0]?.text).toContain('GOVERNMENT');
  });

  it('returns missing segment when sentence (2) is dropped', () => {
    const truncated =
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.';
    const result = diffWarning(CANONICAL, truncated);
    const missing = result.filter((s) => s.kind === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.map((s) => s.text).join('')).toContain('drive');
    // Reconstruct invariants
    expect(reconstructExtracted(result).trim()).toBe(truncated.trim());
    expect(reconstructCanonical(result).trim()).toBe(CANONICAL.trim());
  });

  it('returns no segments when both inputs are empty', () => {
    expect(diffWarning('', '')).toEqual([]);
  });

  it('returns a single missing segment when extracted is empty', () => {
    const result = diffWarning(CANONICAL, '');
    expect(result).toEqual([{ kind: 'missing', text: CANONICAL }]);
  });

  it('returns a single extra segment when canonical is empty', () => {
    const result = diffWarning('', 'something');
    expect(result).toEqual([{ kind: 'extra', text: 'something' }]);
  });

  it('produces mixed extra and missing segments around a swapped word', () => {
    const drifted = CANONICAL.replace('should not drink', 'may not drink');
    const result = diffWarning(CANONICAL, drifted);
    const extras = result.filter((s) => s.kind === 'extra');
    const missing = result.filter((s) => s.kind === 'missing');
    expect(extras.length).toBeGreaterThan(0);
    expect(missing.length).toBeGreaterThan(0);
    expect(reconstructExtracted(result).trim()).toBe(drifted.trim());
    expect(reconstructCanonical(result).trim()).toBe(CANONICAL.trim());
  });
});

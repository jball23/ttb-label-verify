import { describe, it, expect } from 'vitest';
import { formatJSON } from './json-formatter';
import { type ResultLine } from '../results/result-types';

describe('formatJSON', () => {
  it('returns an empty results array for no input', () => {
    expect(JSON.parse(formatJSON([]))).toEqual({ results: [] });
  });

  it('round-trips a single result', () => {
    const result: ResultLine = {
      status: 'ok',
      index: 0,
      filename: 'a.jpg',
      durationMs: 1234,
      report: { overallStatus: 'compliant', crossCheck: { overallStatus: 'match', fields: {} }, fields: {} },
    };
    const parsed = JSON.parse(formatJSON([result]));
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toEqual(result);
  });

  it('produces pretty-printed JSON (indentation present)', () => {
    expect(formatJSON([])).toContain('\n');
  });
});

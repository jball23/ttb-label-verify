import { describe, it, expect } from 'vitest';
import { formatCSV, CSV_COLUMNS } from './csv-formatter';
import { type ResultLine } from '../results/result-types';

describe('formatCSV', () => {
  it('returns just the header row for empty input', () => {
    const csv = formatCSV([]);
    expect(csv).toBe(CSV_COLUMNS.join(',') + '\r\n');
  });

  it('includes all expected columns in the header in order', () => {
    const csv = formatCSV([]);
    const headerLine = csv.split('\r\n')[0];
    expect(headerLine?.split(',')).toEqual([...CSV_COLUMNS]);
  });

  it('emits a row for an ok result with the right fields', () => {
    const result: ResultLine = {
      status: 'ok',
      index: 0,
      filename: 'a.jpg',
      durationMs: 1000,
      report: {
        overallStatus: 'compliant',
        fields: {
          brand: { status: 'pass', extractedValue: 'Wild Acre' },
          abv: { status: 'pass', extractedValue: '40% ALC/VOL' },
        },
      },
    };
    const csv = formatCSV([result]);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('a.jpg');
    expect(lines[1]).toContain('compliant');
    expect(lines[1]).toContain('Wild Acre');
  });

  it('quotes a field containing a comma', () => {
    const result: ResultLine = {
      status: 'ok',
      index: 0,
      filename: 'a.jpg',
      durationMs: 1,
      report: {
        overallStatus: 'compliant',
        fields: {
          producerOrigin: {
            status: 'pass',
            extractedValue: 'Wild Acre, Louisville KY',
          },
        },
      },
    };
    expect(formatCSV([result])).toContain('"Wild Acre, Louisville KY"');
  });

  it('escapes a literal double-quote by doubling it', () => {
    const result: ResultLine = {
      status: 'ok',
      index: 0,
      filename: 'a.jpg',
      durationMs: 1,
      report: {
        overallStatus: 'compliant',
        fields: {
          brand: { status: 'pass', extractedValue: 'Smith "Smithy" Co' },
        },
      },
    };
    expect(formatCSV([result])).toContain('"Smith ""Smithy"" Co"');
  });

  it('quotes a field containing a newline', () => {
    const result: ResultLine = {
      status: 'ok',
      index: 0,
      filename: 'a.jpg',
      durationMs: 1,
      report: {
        overallStatus: 'needs_review',
        fields: {
          governmentWarning: {
            status: 'fail',
            reason: 'line one\nline two',
          },
        },
      },
    };
    expect(formatCSV([result])).toMatch(/"line one\nline two"/);
  });

  it('emits an error row with status=error and the error message', () => {
    const result: ResultLine = {
      status: 'error',
      index: 0,
      filename: 'broken.jpg',
      durationMs: 200,
      errorMessage: 'rate limited',
    };
    const csv = formatCSV([result]);
    expect(csv).toContain('broken.jpg');
    expect(csv).toContain('rate limited');
    expect(csv).toContain('error');
  });
});

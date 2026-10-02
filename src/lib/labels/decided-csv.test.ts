import { describe, expect, it } from 'vitest';
import { decidedLabelsCsv, escapeCsv } from './decided-csv';
import { compliantReading } from './fake-label-reader';
import { type LabelView } from './label-view';
import { assessReading } from './verify-label';

describe('escapeCsv', () => {
  it('quotes only when needed', () => {
    expect(escapeCsv('plain')).toBe('plain');
    expect(escapeCsv('a, b')).toBe('"a, b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('decidedLabelsCsv', () => {
  it('writes a header and one row per label, using corrected values', () => {
    const report = assessReading(compliantReading(), {
      corrections: {
        netContents: {
          value: '1 L',
          correctedAt: '2026-10-01T00:00:00.000Z',
          reviewer: 'JP',
        },
      },
    });
    const view = {
      filename: 'old-tom.jpg',
      status: 'rejected',
      statusAt: '2026-10-01T12:00:00.000Z',
      report,
      decisions: [
        {
          id: 'd',
          createdAt: '2026-10-01T12:00:00.000Z',
          decision: 'rejected',
          reason: 'Wrong size, again',
          reviewer: 'JP',
        },
      ],
    } as unknown as LabelView;

    const [header, row] = decidedLabelsCsv([view]).split('\r\n');
    expect(header).toMatch(
      /^File,Decision,Reason,Reviewer,Decided at,Tool suggestion,Brand name,/,
    );
    expect(row).toContain('old-tom.jpg,rejected,"Wrong size, again",JP,');
    expect(row).toContain(',1 L,');
    expect(row!.endsWith(',netContents')).toBe(true);
  });
});

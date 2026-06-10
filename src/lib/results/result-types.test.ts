import { describe, it, expect } from 'vitest';
import { ResultLineSchema } from './result-types';

function validOkLine(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: 'ok',
    index: 0,
    filename: 'label.jpg',
    durationMs: 1234,
    report: {
      overallStatus: 'compliant',
      crossCheck: {
        overallStatus: 'match',
        fields: {
          brandName: {
            id: 'brandName',
            label: 'Brand name',
            status: 'match',
            applicationValue: 'Ridge Creek',
            labelValue: 'Ridge Creek',
          },
        },
      },
      fields: {
        brand: { status: 'pass', extractedValue: 'Ridge Creek' },
      },
    },
    ...overrides,
  };
}

describe('ResultLineSchema', () => {
  it('parses a full ok line with cross-check section', () => {
    const result = ResultLineSchema.safeParse(validOkLine());
    expect(result.success).toBe(true);
  });

  it('parses an error line', () => {
    const result = ResultLineSchema.safeParse({
      status: 'error',
      index: 0,
      filename: 'broken.jpg',
      durationMs: 50,
      errorMessage: 'unreadable',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an ok line missing crossCheck', () => {
    const line = validOkLine();
    delete (line as { report: { crossCheck?: unknown } }).report.crossCheck;
    const result = ResultLineSchema.safeParse(line);
    expect(result.success).toBe(false);
  });

  it('rejects crossCheck.overallStatus outside the enum', () => {
    const line = validOkLine() as {
      report: { crossCheck: { overallStatus: string } };
    };
    line.report.crossCheck.overallStatus = 'invalid';
    const result = ResultLineSchema.safeParse(line);
    expect(result.success).toBe(false);
  });

  it('rejects a cross-check field with an invalid status', () => {
    const line = validOkLine() as {
      report: { crossCheck: { fields: { brandName: { status: string } } } };
    };
    line.report.crossCheck.fields.brandName.status = 'kinda-matched';
    const result = ResultLineSchema.safeParse(line);
    expect(result.success).toBe(false);
  });

  it('rejects a cross-check field whose id is not in the enum', () => {
    const line = validOkLine() as {
      report: {
        crossCheck: { fields: Record<string, Record<string, unknown>> };
      };
    };
    line.report.crossCheck.fields.bogus = {
      id: 'bogus',
      label: 'Bogus',
      status: 'match',
      applicationValue: null,
      labelValue: null,
    };
    const result = ResultLineSchema.safeParse(line);
    expect(result.success).toBe(false);
  });
});

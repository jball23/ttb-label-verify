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
      provenance: {
        'application.brandName': {
          page: 0,
          bbox: { x: 0.1, y: 0.15, w: 0.2, h: 0.03 },
          confidence: 'high',
        },
      },
      extractedForm: {
        plantRegistryNumber: null,
        source: null,
        serialNumber: null,
        productType: null,
        brandName: null,
        fancifulName: null,
        applicant: {
          name: null,
          addressLine1: null,
          city: null,
          state: null,
          postalCode: null,
        },
        grapeVarietals: null,
        wineAppellation: null,
        phone: null,
        email: null,
        applicationType: null,
        applicationDate: null,
        repId: null,
        mailingAddress: null,
        formula: null,
        containerWording: null,
        applicantSignatureName: null,
      },
      extractedLabel: {
        brandName: null,
        abv: null,
        governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
        netContents: null,
        classType: null,
        producer: null,
        countryOfOrigin: null,
        wineVarietal: null,
        wineAppellation: null,
        extractionConfidence: 'high',
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

  it('accepts an ok line without crossCheck (Phase A sync path)', () => {
    // Phase A: the sync verify path skips form-side OCR, so crossCheck is
    // absent until Phase B's patch endpoint fills it in. The wire schema
    // accepts both shapes — present (patched / legacy) and absent (sync).
    const line = validOkLine();
    delete (line as { report: { crossCheck?: unknown } }).report.crossCheck;
    const result = ResultLineSchema.safeParse(line);
    expect(result.success).toBe(true);
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

  it('accepts an ok line with an empty provenance map', () => {
    const line = validOkLine() as {
      report: { provenance: Record<string, unknown> };
    };
    line.report.provenance = {};
    expect(ResultLineSchema.safeParse(line).success).toBe(true);
  });

  it('rejects an ok line missing provenance entirely', () => {
    const line = validOkLine();
    delete (line as { report: { provenance?: unknown } }).report.provenance;
    expect(ResultLineSchema.safeParse(line).success).toBe(false);
  });

  it('rejects a provenance entry with an out-of-range bbox', () => {
    const line = validOkLine() as {
      report: {
        provenance: Record<
          string,
          { page: number; bbox: Record<string, number>; confidence: string }
        >;
      };
    };
    line.report.provenance['application.brandName']!.bbox.x = 1.5;
    expect(ResultLineSchema.safeParse(line).success).toBe(false);
  });

  it('rejects a provenance entry under an unknown field path', () => {
    const line = validOkLine() as {
      report: { provenance: Record<string, unknown> };
    };
    line.report.provenance['application.bogus'] = {
      page: 0,
      bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
      confidence: 'high',
    };
    expect(ResultLineSchema.safeParse(line).success).toBe(false);
  });

  it('does not require provenance on error lines', () => {
    expect(
      ResultLineSchema.safeParse({
        status: 'error',
        index: 0,
        filename: 'x.pdf',
        durationMs: 5,
        errorMessage: 'oops',
      }).success,
    ).toBe(true);
  });
});

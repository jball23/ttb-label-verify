import { describe, expect, it } from 'vitest';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import { compliantReading } from './fake-label-reader';
import { byProblemsFirst, labelTitle, summarizeReport } from './presentation';
import { assessReading } from './verify-label';

describe('summarizeReport', () => {
  it('leads with a failed rule', () => {
    const report = assessReading(
      compliantReading({
        governmentWarning: {
          verbatimText: CANONICAL.replace('GOVERNMENT', 'Government'),
          prefixAppearsBold: true,
        },
      }),
      { expected: { alcoholContent: '40%' } },
    );
    expect(summarizeReport(report)).toMatch(/capital letters/);
  });

  it('then a value that differs from the application', () => {
    expect(
      summarizeReport(
        assessReading(compliantReading(), { expected: { alcoholContent: '40%' } }),
      ),
    ).toBe('Alcohol content differs from the application.');
  });

  it('asks for a better photo when the image cannot be read', () => {
    const report = assessReading(
      compliantReading({
        imageQuality: { legible: false, issues: ['glare over the warning.'] },
      }),
    );
    expect(summarizeReport(report)).toBe(
      'Glare over the warning. Ask for a better photo.',
    );
  });

  it('says so when everything is fine', () => {
    expect(summarizeReport(assessReading(compliantReading()))).toBe(
      'Everything required is on the label.',
    );
  });
});

describe('byProblemsFirst', () => {
  it('sorts worst verdicts first, then oldest first', () => {
    const row = (
      id: string,
      verdict: 'looks_good' | 'needs_review' | 'problems_found',
      createdAt: string,
    ) => ({
      id,
      createdAt,
      report: { verdict },
    });
    const rows = [
      row('good', 'looks_good', '2026-10-01T10:00:00Z'),
      row('problem-late', 'problems_found', '2026-10-01T10:05:00Z'),
      row('look', 'needs_review', '2026-10-01T09:00:00Z'),
      row('problem-early', 'problems_found', '2026-10-01T10:01:00Z'),
    ];
    expect(rows.sort(byProblemsFirst).map((r) => r.id)).toEqual([
      'problem-early',
      'problem-late',
      'look',
      'good',
    ]);
  });
});

describe('labelTitle', () => {
  it('prefers the brand, falling back to the file name', () => {
    expect(labelTitle(assessReading(compliantReading()), 'a.jpg')).toBe(
      'OLD TOM DISTILLERY',
    );
    const noBrand = compliantReading();
    noBrand.fields.brandName = { value: null, confidence: 'high' };
    expect(labelTitle(assessReading(noBrand), 'a.jpg')).toBe('a.jpg');
  });
});

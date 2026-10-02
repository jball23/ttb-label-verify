import { describe, expect, it } from 'vitest';
import { buildChecklist } from './checklist';
import { compliantReading } from './fake-label-reader';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import { assessReading } from './verify-label';

const byField = (items: ReturnType<typeof buildChecklist>) =>
  Object.fromEntries(items.map((i) => [i.field, i]));

describe('buildChecklist', () => {
  it('has one item per field, each with its requirement', () => {
    const items = buildChecklist(assessReading(compliantReading()));
    expect(items.map((i) => i.field).sort()).toEqual(
      [
        'alcoholContent',
        'brandName',
        'classType',
        'countryOfOrigin',
        'governmentWarning',
        'netContents',
        'producer',
      ].sort(),
    );
    expect(items.every((i) => i.requirement.summary.length > 0)).toBe(true);
  });

  it('puts problems first and gives the reason', () => {
    const report = assessReading(
      compliantReading({
        governmentWarning: {
          verbatimText: CANONICAL.replace('GOVERNMENT', 'Government'),
          prefixAppearsBold: true,
        },
      }),
    );
    const [first] = buildChecklist(report);
    expect(first).toMatchObject({ field: 'governmentWarning', status: 'fail' });
    expect(first!.reason).toMatch(/capital letters/);
  });

  it('turns a passing field into "needs a look" when it differs from the application', () => {
    const item = byField(
      buildChecklist(
        assessReading(compliantReading(), { expected: { alcoholContent: '40%' } }),
      ),
    ).alcoholContent!;
    expect(item.status).toBe('review');
    expect(item.reason).toBe('Differs from the application ("40%").');
  });

  // Silver Birch Premium was shown as "Not found on the label" despite "Portland, Oregon".
  it('infers a domestic country of origin from the bottler address', () => {
    // compliantReading's producer is "Bottled by Old Tom Distillery, Bardstown, Kentucky".
    const item = byField(
      buildChecklist(assessReading(compliantReading())),
    ).countryOfOrigin!;
    expect(item).toMatchObject({
      status: 'pass',
      value: 'United States',
      valueNote: "From the bottler's address: Bardstown, Kentucky",
      locate: 'Bardstown, Kentucky',
    });
  });

  it('compares the inferred country with the application', () => {
    const report = (country: string) =>
      assessReading(compliantReading(), { expected: { countryOfOrigin: country } });
    expect(
      byField(buildChecklist(report('USA'))).countryOfOrigin!.comparison?.status,
    ).toBe('match');
    expect(byField(buildChecklist(report('Mexico'))).countryOfOrigin).toMatchObject({
      status: 'review',
      reason: expect.stringMatching(/Mexico/),
    });
  });

  it('is not checked when the label gives nothing to go on', () => {
    const reading = compliantReading();
    reading.fields.producer = { value: 'Old Tom Distillery', confidence: 'high' };
    expect(byField(buildChecklist(assessReading(reading))).countryOfOrigin!.status).toBe(
      'not_checked',
    );
  });

  it('shows the corrected value and keeps what was read', () => {
    const report = assessReading(compliantReading(), {
      corrections: {
        netContents: {
          value: '1 L',
          correctedAt: '2026-10-02T00:00:00.000Z',
          reviewer: 'JP',
        },
      },
    });
    const item = byField(buildChecklist(report)).netContents!;
    expect(item).toMatchObject({
      value: '1 L',
      readValue: '750 mL',
      correction: { reviewer: 'JP' },
      correctionKind: 'changed',
    });
  });
});

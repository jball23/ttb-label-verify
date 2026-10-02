import { describe, expect, it } from 'vitest';
import { compareExpected } from './compare-expected';
import { compliantReading } from './fake-label-reader';
import { type ExpectedValues, type LabelFieldId } from './reading';

function statusFor(field: LabelFieldId, expected: string, found: string | null) {
  const reading = compliantReading();
  reading.fields[field] = { value: found, confidence: 'high' };
  const values: ExpectedValues = { [field]: expected };
  return compareExpected(values, reading).find((c) => c.field === field)!.status;
}

describe('compareExpected', () => {
  // Dave Morrison: "STONE'S THROW" on the label vs "Stone's Throw" in the
  // application is obviously the same thing.
  it('matches brand names regardless of case and quote style', () => {
    expect(statusFor('brandName', "Stone's Throw", "STONE'S THROW")).toBe('match');
    expect(statusFor('brandName', "Stone's Throw", 'STONE’S THROW')).toBe('match');
  });

  it('flags a different brand', () => {
    expect(statusFor('brandName', 'Stone Throw Reserve', "STONE'S THROW")).toBe(
      'differs',
    );
  });

  it('matches alcohol content by amount, not wording', () => {
    expect(statusFor('alcoholContent', '45%', '45% Alc./Vol. (90 Proof)')).toBe('match');
    expect(statusFor('alcoholContent', '90 proof', '45% Alc./Vol.')).toBe('match');
    expect(statusFor('alcoholContent', '40%', '45% Alc./Vol.')).toBe('differs');
  });

  it('matches net contents across units', () => {
    expect(statusFor('netContents', '750 mL', '75 cL')).toBe('match');
    expect(statusFor('netContents', '1 L', '750 mL')).toBe('differs');
  });

  it('matches producers by name and place', () => {
    expect(
      statusFor(
        'producer',
        'Old Tom Distillery, Bardstown, KY',
        'Bottled by Old Tom Distillery, Bardstown, Kentucky',
      ),
    ).toBe('match');
  });

  it('distinguishes not entered from not on the label', () => {
    const reading = compliantReading();
    const byField = Object.fromEntries(
      compareExpected({ countryOfOrigin: 'Mexico' }, reading).map((c) => [
        c.field,
        c.status,
      ]),
    );
    expect(byField.countryOfOrigin).toBe('not_found_on_label');
    expect(byField.brandName).toBe('not_entered');
  });
});

import { describe, expect, it } from 'vitest';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import { compliantReading, FakeLabelReader } from './fake-label-reader';
import { type LabelImage } from './label-reader';
import { assessReading, verifyLabel } from './verify-label';

const image: LabelImage = { bytes: Buffer.from([0xff, 0xd8]), mimeType: 'image/jpeg' };

describe('verifyLabel', () => {
  it('reads the image once and assesses the reading', async () => {
    let calls = 0;
    const reader = new FakeLabelReader(() => {
      calls += 1;
      return compliantReading();
    });
    const report = await verifyLabel(image, { reader, expected: { brandName: 'Old Tom Distillery' } });
    expect(calls).toBe(1);
    expect(report.verdict).toBe('looks_good');
    expect(report.comparisons.find((c) => c.field === 'brandName')?.status).toBe('match');
  });
});

describe('assessReading verdicts', () => {
  it('finds a problem when the warning is wrong', () => {
    const reading = compliantReading({
      governmentWarning: { verbatimText: CANONICAL.replace('GOVERNMENT WARNING', 'Government Warning'), prefixAppearsBold: true },
    });
    expect(assessReading(reading).verdict).toBe('problems_found');
  });

  it('asks for a look when an application value differs, rather than rejecting', () => {
    expect(assessReading(compliantReading(), { expected: { alcoholContent: '40%' } }).verdict).toBe('needs_review');
  });

  it('asks for a look when an application value is not on the label', () => {
    expect(assessReading(compliantReading(), { expected: { countryOfOrigin: 'Mexico' } }).verdict).toBe('needs_review');
  });

  it('never gives a verdict on an unreadable image', () => {
    const reading = compliantReading({ imageQuality: { legible: false, issues: ['glare over the label'] } });
    expect(assessReading(reading).verdict).toBe('needs_review');
  });
});

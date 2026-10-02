import { describe, expect, it } from 'vitest';
import { buildChecklist } from './checklist';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import { compliantReading, FakeLabelReader } from './fake-label-reader';
import { type LabelImage } from './label-reader';
import { assessReading, readLabel, verifyLabel } from './verify-label';

const image: LabelImage = { bytes: Buffer.from([0xff, 0xd8]), mimeType: 'image/jpeg' };

describe('verifyLabel', () => {
  it('reads the image once and assesses the reading', async () => {
    let calls = 0;
    const reader = new FakeLabelReader(() => {
      calls += 1;
      return compliantReading();
    });
    const report = await verifyLabel(image, {
      reader,
      expected: { brandName: 'Old Tom Distillery' },
    });
    expect(calls).toBe(1);
    expect(report.verdict).toBe('looks_good');
    expect(report.comparisons.find((c) => c.field === 'brandName')?.status).toBe('match');
  });
});

describe('assessReading verdicts', () => {
  it('finds a problem when the warning is wrong', () => {
    const reading = compliantReading({
      governmentWarning: {
        verbatimText: CANONICAL.replace('GOVERNMENT WARNING', 'Government Warning'),
        prefixAppearsBold: true,
      },
    });
    expect(assessReading(reading).verdict).toBe('problems_found');
  });

  it('asks for a look when an application value differs, rather than rejecting', () => {
    expect(
      assessReading(compliantReading(), { expected: { alcoholContent: '40%' } }).verdict,
    ).toBe('needs_review');
  });

  it('asks for a look when an application value is not on the label', () => {
    expect(
      assessReading(compliantReading(), { expected: { countryOfOrigin: 'Mexico' } })
        .verdict,
    ).toBe('needs_review');
  });

  it('never gives a verdict on an unreadable image', () => {
    const reading = compliantReading({
      imageQuality: { legible: false, issues: ['glare over the label'] },
    });
    expect(assessReading(reading).verdict).toBe('needs_review');
  });
});

describe('assessReading on a stored reading', () => {
  // Labels saved before the importer field existed have no `importer` key.
  it('assesses a reading saved before a field existed', () => {
    const stored = compliantReading();
    delete (stored.fields as Partial<typeof stored.fields>).importer;
    const report = assessReading(stored);
    expect(report.reading.fields.importer).toEqual({ value: null, confidence: 'high' });
    expect(buildChecklist(report).length).toBeGreaterThan(0);
  });

  // Old Tom, live eval: the model read the absent importer as "," (low confidence).
  it('treats a punctuation-only reading as not on the label', () => {
    const stored = compliantReading();
    stored.fields.importer = { value: ',', confidence: 'low' };
    const report = assessReading(stored);
    expect(report.reading.fields.importer.value).toBeNull();
    expect(report.verdict).toBe('looks_good');
  });
});

describe('readLabel: confirming a warning problem before failing', () => {
  const misread = CANONICAL.replace(
    'alcoholic beverages during',
    'alcohol beverages during',
  );
  const withWarning = (verbatimText: string | null) =>
    compliantReading({ governmentWarning: { verbatimText, prefixAppearsBold: true } });

  function counting(first: string | null, second: string | null) {
    let warningReads = 0;
    const reader = new FakeLabelReader(
      () => withWarning(first),
      () => {
        warningReads += 1;
        return second;
      },
    );
    return { reader, warningReads: () => warningReads };
  }

  // Seen live: small type read as "alcohol" for "alcoholic" on a compliant label.
  it('accepts the label when a focused second read is the exact text', async () => {
    const { reader, warningReads } = counting(misread, CANONICAL);
    const reading = await readLabel(reader, image);
    expect(warningReads()).toBe(1);
    expect(assessReading(reading).verdict).toBe('looks_good');
  });

  it('still fails when the second read also differs', async () => {
    const titleCase = CANONICAL.replace('GOVERNMENT WARNING', 'Government Warning');
    const { reader } = counting(titleCase, titleCase);
    expect(assessReading(await readLabel(reader, image)).verdict).toBe('problems_found');
  });

  it('keeps the first reading when the second read is wrong in a different way', async () => {
    const { reader } = counting(misread, null);
    const reading = await readLabel(reader, image);
    expect(reading.governmentWarning.verbatimText).toBe(misread);
  });

  it('does not re-read an exact warning or a missing one', async () => {
    for (const first of [CANONICAL, null]) {
      const { reader, warningReads } = counting(first, CANONICAL);
      await readLabel(reader, image);
      expect(warningReads()).toBe(0);
    }
  });
});

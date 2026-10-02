import { describe, expect, it } from 'vitest';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import {
  applyCorrections,
  isConfirmation,
  reconcileCorrections,
  type Corrections,
} from './corrections';
import { compliantReading } from './fake-label-reader';
import { assessReading } from './verify-label';

const stamp = (iso: string, reviewer: string | null = 'JP') => ({
  at: new Date(iso),
  reviewer,
});

describe('applyCorrections', () => {
  it('replaces read values and marks them certain, leaving the reading untouched', () => {
    const reading = compliantReading();
    reading.fields.netContents = { value: '75O mL', confidence: 'low' };
    const corrections: Corrections = {
      netContents: {
        value: '750 mL',
        correctedAt: '2026-10-01T00:00:00.000Z',
        reviewer: 'JP',
      },
    };
    const effective = applyCorrections(reading, corrections);
    expect(effective.fields.netContents).toEqual({ value: '750 mL', confidence: 'high' });
    expect(reading.fields.netContents.value).toBe('75O mL');
  });

  it('corrects the warning text', () => {
    const reading = compliantReading({
      governmentWarning: { verbatimText: null },
    });
    const effective = applyCorrections(reading, {
      governmentWarning: {
        value: CANONICAL,
        correctedAt: '2026-10-01T00:00:00.000Z',
        reviewer: null,
      },
    });
    expect(effective.governmentWarning.verbatimText).toBe(CANONICAL);
  });
});

describe('reconcileCorrections', () => {
  const reading = compliantReading();

  it('stamps new corrections, keeping a confirmed reading as a confirmation', () => {
    const next = reconcileCorrections(
      {},
      { brandName: 'OLD TOM DISTILLERY', netContents: ' 1 L ' },
      stamp('2026-10-01T10:00:00Z'),
    );
    expect(next).toEqual({
      brandName: {
        value: 'OLD TOM DISTILLERY',
        correctedAt: '2026-10-01T10:00:00.000Z',
        reviewer: 'JP',
      },
      netContents: {
        value: '1 L',
        correctedAt: '2026-10-01T10:00:00.000Z',
        reviewer: 'JP',
      },
    });
    expect(isConfirmation(reading, 'brandName', next.brandName!)).toBe(true);
    expect(isConfirmation(reading, 'netContents', next.netContents!)).toBe(false);
  });

  // A reviewer confirming an unsure reading clears the "hard to read" flag.
  it('lets a confirmation settle a low-confidence reading', () => {
    const unsure = compliantReading();
    unsure.fields.classType = { value: 'India Pale Ale', confidence: 'low' };
    expect(assessReading(unsure).verdict).toBe('needs_review');
    const corrections = reconcileCorrections(
      {},
      { classType: 'India Pale Ale' },
      stamp('2026-10-01T10:00:00Z'),
    );
    expect(assessReading(unsure, { corrections }).verdict).toBe('looks_good');
  });

  it('keeps the original stamp for an unchanged correction and drops omitted ones', () => {
    const previous: Corrections = {
      netContents: {
        value: '1 L',
        correctedAt: '2026-10-01T10:00:00.000Z',
        reviewer: 'JP',
      },
      classType: {
        value: 'Gin',
        correctedAt: '2026-10-01T10:00:00.000Z',
        reviewer: 'JP',
      },
    };
    const next = reconcileCorrections(
      previous,
      { netContents: '1 L' },
      stamp('2026-10-02T09:00:00Z', 'DM'),
    );
    expect(next).toEqual({ netContents: previous.netContents });
  });

  it('records "not on the label" as a correction to null', () => {
    const next = reconcileCorrections(
      {},
      { producer: '' },
      stamp('2026-10-01T10:00:00Z'),
    );
    expect(next.producer).toMatchObject({ value: null });
  });
});

describe('assessReading with corrections', () => {
  it('re-runs the rules on the corrected text', () => {
    const reading = compliantReading({
      governmentWarning: { verbatimText: null },
    });
    expect(assessReading(reading).verdict).toBe('problems_found');
    const corrected = assessReading(reading, {
      corrections: {
        governmentWarning: {
          value: CANONICAL,
          correctedAt: '2026-10-01T00:00:00.000Z',
          reviewer: 'JP',
        },
      },
    });
    expect(corrected.verdict).toBe('looks_good');
    expect(corrected.reading.governmentWarning.verbatimText).toBeNull();
  });
});

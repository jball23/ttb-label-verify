import { describe, expect, it } from 'vitest';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from '../ttb-constants';
import { compliantReading } from '../fake-label-reader';
import { type LabelReading } from '../reading';
import { runLabelRules } from '.';

function statusOf(reading: LabelReading, ruleId: string) {
  return runLabelRules(reading).find((r) => r.id === ruleId)!;
}

function withField(field: keyof LabelReading['fields'], value: string | null, confidence: 'high' | 'low' = 'high') {
  const reading = compliantReading();
  reading.fields[field] = { value, confidence };
  return reading;
}

function withWarning(verbatimText: string | null, prefixAppearsBold: boolean | null = true) {
  return compliantReading({ governmentWarning: { verbatimText, prefixAppearsBold } });
}

describe('label rules', () => {
  it('passes every rule on a compliant label', () => {
    expect(runLabelRules(compliantReading()).map((r) => r.status)).toEqual(
      Array(runLabelRules(compliantReading()).length).fill('pass'),
    );
  });

  describe('government warning', () => {
    it('fails a title-case lead-in', () => {
      const outcome = statusOf(withWarning(CANONICAL.replace('GOVERNMENT WARNING', 'Government Warning')), 'governmentWarning');
      expect(outcome.status).toBe('fail');
      expect(outcome.reason).toContain('capital letters');
    });

    it('fails a missing warning', () => {
      expect(statusOf(withWarning(null), 'governmentWarning').status).toBe('fail');
    });

    it('asks for a look when the lead-in may not be bold', () => {
      expect(statusOf(withWarning(CANONICAL, false), 'governmentWarning').status).toBe('review');
      expect(statusOf(withWarning(CANONICAL, null), 'governmentWarning').status).toBe('review');
    });
  });

  describe('field rules', () => {
    it('fails a missing mandatory statement', () => {
      expect(statusOf(withField('brandName', null), 'brandName').status).toBe('fail');
      expect(statusOf(withField('netContents', '  '), 'netContents').status).toBe('fail');
    });

    it('asks for a look when alcohol content is missing, since some products are exempt', () => {
      expect(statusOf(withField('alcoholContent', null), 'alcoholContent').status).toBe('review');
    });

    it('asks for a look when a reading is unsure', () => {
      expect(statusOf(withField('brandName', 'OLD TOM', 'low'), 'brandName').status).toBe('review');
    });

    it('asks for a look when a statement is badly formed', () => {
      expect(statusOf(withField('alcoholContent', 'Strong'), 'alcoholContent').status).toBe('review');
      expect(statusOf(withField('netContents', 'One bottle'), 'netContents').status).toBe('review');
    });

    // Sample 05 (Calypso rum) prints "80 PROOF" with no percentage.
    it('asks for a look when alcohol content is shown only as proof', () => {
      const outcome = statusOf(withField('alcoholContent', '80 PROOF'), 'alcoholContent');
      expect(outcome.status).toBe('review');
      expect(outcome.reason).toContain('only as proof');
    });
  });
});

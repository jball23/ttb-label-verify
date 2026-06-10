import { describe, it, expect } from 'vitest';
import netContentsRule from './net-contents';
import { type ExtractedFields } from '../../extraction/types';

function fields(netContents: string | null): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    wineVarietal: null,
    wineAppellation: null,    extractionConfidence: 'high',
  };
}

describe('net-contents rule', () => {
  it.each(['750 mL', '1.75 L', '25.4 fl oz', '12 FL OZ', '500ml'])(
    'passes on valid net contents: %s',
    (input) => {
      expect(netContentsRule.check(fields(input)).status).toBe('pass');
    },
  );

  it('fails when null', () => {
    const result = netContentsRule.check(fields(null));
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/not detected|missing/i);
  });

  it.each(['big bottle', 'large', '12 servings', '750'])(
    'fails on invalid: %s',
    (input) => {
      const result = netContentsRule.check(fields(input));
      expect(result.status).toBe('fail');
    },
  );
});

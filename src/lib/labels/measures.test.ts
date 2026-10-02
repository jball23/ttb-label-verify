import { describe, expect, it } from 'vitest';
import { amountsAgree, parseAlcoholPercent, parseVolumeMl } from './measures';

describe('parseAlcoholPercent', () => {
  it.each([
    ['45% Alc./Vol. (90 Proof)', 45],
    ['40% ALC/VOL', 40],
    ['12.5 % alcohol by volume', 12.5],
    ['90 Proof', 45],
    ['86°proof', 43],
    ['40', 40],
  ])('reads %s as %d', (text, percent) => {
    expect(parseAlcoholPercent(text)).toBe(percent);
  });

  it.each([null, '', 'Strong stuff'])('returns null for %s', (text) => {
    expect(parseAlcoholPercent(text)).toBeNull();
  });
});

describe('parseVolumeMl', () => {
  it.each([
    ['750 mL', 750],
    ['750ML', 750],
    ['75 cL', 750],
    ['1 L', 1000],
    ['1.75 Liters', 1750],
    ['Net Contents: 375 ml', 375],
  ])('reads %s as %d mL', (text, ml) => {
    expect(parseVolumeMl(text)).toBe(ml);
  });

  it('converts US fluid ounces', () => {
    expect(parseVolumeMl('12 FL OZ')).toBeCloseTo(354.88, 1);
  });

  it.each([null, 'seven fifty', '750'])('returns null for %s', (text) => {
    expect(parseVolumeMl(text)).toBeNull();
  });
});

describe('amountsAgree', () => {
  it('tolerates rounding but not real differences', () => {
    expect(amountsAgree(354.88, 355)).toBe(true);
    expect(amountsAgree(45, 40)).toBe(false);
  });
});

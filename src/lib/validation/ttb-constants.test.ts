import { describe, it, expect } from 'vitest';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_SENTENCE_1,
  GOVERNMENT_WARNING_SENTENCE_2,
  ABV_PATTERN,
  NET_CONTENTS_PATTERN,
  normalizeWhitespace,
} from './ttb-constants';

describe('TTB constants', () => {
  it('canonical warning text is exactly 283 characters (pin against accidental edits)', () => {
    expect(GOVERNMENT_WARNING_CANONICAL.length).toBe(283);
  });

  it('canonical warning starts with the all-caps prefix', () => {
    expect(GOVERNMENT_WARNING_CANONICAL.startsWith(GOVERNMENT_WARNING_PREFIX)).toBe(
      true,
    );
  });

  it('canonical warning contains sentence (1) about pregnancy verbatim', () => {
    expect(GOVERNMENT_WARNING_CANONICAL).toContain(GOVERNMENT_WARNING_SENTENCE_1);
  });

  it('canonical warning contains sentence (2) about driving verbatim', () => {
    expect(GOVERNMENT_WARNING_CANONICAL).toContain(GOVERNMENT_WARNING_SENTENCE_2);
  });

  it('canonical warning matches the concatenated prefix + sentences with single spaces', () => {
    const rebuilt = `${GOVERNMENT_WARNING_PREFIX} ${GOVERNMENT_WARNING_SENTENCE_1} ${GOVERNMENT_WARNING_SENTENCE_2}`;
    expect(GOVERNMENT_WARNING_CANONICAL).toBe(rebuilt);
  });

  describe('ABV_PATTERN', () => {
    it.each([
      '40% ALC/VOL',
      '40.0% Alcohol by Volume',
      '8.0%',
      '40',
      '45.5%',
      '5% alc/vol',
    ])('accepts %s', (input) => {
      expect(ABV_PATTERN.test(input)).toBe(true);
    });

    it.each(['forty percent', 'high', '', 'abc', '40 percent strong'])(
      'rejects %s',
      (input) => {
        expect(ABV_PATTERN.test(input)).toBe(false);
      },
    );
  });

  describe('NET_CONTENTS_PATTERN', () => {
    it.each(['750 mL', '1.75 L', '12 FL OZ', '25.4 fl oz', '500ml', '1L'])(
      'accepts %s',
      (input) => {
        expect(NET_CONTENTS_PATTERN.test(input)).toBe(true);
      },
    );

    it.each(['big bottle', '750', 'large', '', '12 servings'])(
      'rejects %s',
      (input) => {
        expect(NET_CONTENTS_PATTERN.test(input)).toBe(false);
      },
    );
  });

  describe('normalizeWhitespace', () => {
    it('collapses multiple spaces to one', () => {
      expect(normalizeWhitespace('a  b   c')).toBe('a b c');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeWhitespace('  hello  ')).toBe('hello');
    });

    it('handles newlines and tabs as whitespace', () => {
      expect(normalizeWhitespace('a\n\tb')).toBe('a b');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_SENTENCE_1,
  GOVERNMENT_WARNING_SENTENCE_2,
  normalizeWhitespace,
} from './ttb-constants';

describe('TTB constants', () => {
  it('canonical warning text is exactly 283 characters (pin against accidental edits)', () => {
    expect(GOVERNMENT_WARNING_CANONICAL.length).toBe(283);
  });

  it('canonical warning starts with the all-caps prefix', () => {
    expect(GOVERNMENT_WARNING_CANONICAL.startsWith(GOVERNMENT_WARNING_PREFIX)).toBe(true);
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

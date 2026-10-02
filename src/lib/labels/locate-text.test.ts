import { describe, expect, it } from 'vitest';
import { locateText, tokenize, type OcrWord } from './locate-text';

/** Lays words out left to right, one printed line per inner array. */
function page(lines: string[][]): OcrWord[] {
  return lines.flatMap((line, lineIndex) =>
    line.map((text, i) => ({ text, line: lineIndex, bbox: { x0: i * 100, y0: lineIndex * 50, x1: i * 100 + 90, y1: lineIndex * 50 + 40 } })),
  );
}

const LABEL = page([
  ['OLD', 'TOM', 'DISTILLERY'],
  ['Kentucky', 'Straight', 'Bourbon', 'Whiskey'],
  ['45%', 'Alc./Vol.', '(90', 'Proof)', '750', 'mL'],
  ['GOVERNMENT', 'WARNING:', '(1)', 'According', 'to', 'the'],
  ['Surgeon', 'General,', 'women', 'should', 'not', 'drink'],
]);

describe('locateText', () => {
  it('boxes a one-line value', () => {
    expect(locateText(LABEL, 'OLD TOM DISTILLERY')).toEqual([{ x0: 0, y0: 0, x1: 290, y1: 40 }]);
  });

  it('ignores case and punctuation differences', () => {
    expect(locateText(LABEL, '750 ml')).toEqual([{ x0: 400, y0: 100, x1: 590, y1: 140 }]);
  });

  it('returns one box per printed line for text that wraps', () => {
    const boxes = locateText(LABEL, 'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink');
    expect(boxes).toHaveLength(2);
    expect(boxes![0]).toMatchObject({ y0: 150 });
    expect(boxes![1]).toMatchObject({ y0: 200 });
  });

  it('tolerates a one-character OCR slip in longer words', () => {
    const slipped = page([['OLD', 'TOM', 'DISTIL1ERY']]);
    expect(locateText(slipped, 'OLD TOM DISTILLERY')).not.toBeNull();
  });

  // Seen live: an angled headline was unreadable, and "Old Tom" in the small
  // "Bottled by Old Tom Distilling" line got boxed as the brand.
  it('does not box a partial match of a short value', () => {
    const producerLine = page([['Bottled', 'by', 'Old', 'Tom', 'Distilling']]);
    expect(locateText(producerLine, 'OLD TOM DISTILLERY')).toBeNull();
  });

  it('tolerates missing words in long text', () => {
    const words = 'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink'.split(' ');
    const garbled = page([words.map((w, i) => (i % 4 === 3 ? '~~~' : w))]);
    expect(locateText(garbled, words.join(' '))).not.toBeNull();
  });

  it('accepts look-alike characters and words OCR ran together', () => {
    expect(locateText(page([['8O', 'PROOF']]), '80 PROOF')).not.toBeNull();
    expect(locateText(page([['80PROOF']]), '80 PROOF')).not.toBeNull();
    expect(locateText(page([['750', 'mI']]), '750 mL')).not.toBeNull();
  });

  it('returns null when the text is not on the image', () => {
    expect(locateText(LABEL, 'Product of Mexico')).toBeNull();
    expect(locateText(LABEL, null)).toBeNull();
    expect(locateText([], 'OLD TOM')).toBeNull();
  });

  it('requires every word of a short value', () => {
    expect(locateText(LABEL, 'Old Fashioned')).toBeNull();
  });
});

describe('tokenize', () => {
  it('splits on anything that is not a letter or digit', () => {
    expect(tokenize("45% Alc./Vol. (90 Proof) STONE'S")).toEqual(['45', 'alc', 'vol', '90', 'proof', 'stone', 's']);
  });
});

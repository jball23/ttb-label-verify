/**
 * Finds where a piece of text the model read sits on the label image, using
 * word boxes from OCR. Used only to highlight; it never affects a verdict.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: Box;
  /** Words on the same printed line share a line number. */
  line: number;
}

/** Share of a long text's words that must be found, in order, to call it located. */
const MIN_MATCH_SHARE = 0.6;
/** Values this short must match every word, or a stray partial match draws a misleading box. */
const EXACT_UP_TO_WORDS = 3;

interface Token {
  value: string;
  word: number;
}

/**
 * The boxes (one per printed line) covering `text`, or null when it cannot
 * be found. Tolerates OCR slips: a word may differ by one character, and in
 * text longer than three words up to 40% may be missing or misread.
 */
export function locateText(words: readonly OcrWord[], text: string | null): Box[] | null {
  const target = tokenize(text ?? '');
  if (target.length === 0) return null;
  const stream: Token[] = words.flatMap((word, index) =>
    tokenize(word.text).map((value) => ({ value, word: index })),
  );

  // Text can appear more than once (a brand in the headline and again in the
  // "Bottled by" line). Prefer the most complete match, then the largest type.
  let best: { matched: number; first: number; last: number; height: number } | null =
    null;
  for (let start = 0; start < stream.length; start++) {
    const value = stream[start]!.value;
    const opens = [target[0]!, target[1] ?? '', target[0]! + (target[1] ?? '')].some(
      (t) => tokensMatch(value, t),
    );
    if (!opens) continue;
    const found = alignFrom(stream, start, target);
    if (!found) continue;
    const height = meanHeight(words, stream[found.first]!.word, stream[found.last]!.word);
    if (
      !best ||
      found.matched > best.matched ||
      (found.matched === best.matched && height > best.height)
    ) {
      best = { ...found, height };
    }
  }

  const required =
    target.length <= EXACT_UP_TO_WORDS
      ? target.length
      : Math.ceil(target.length * MIN_MATCH_SHARE);
  if (!best || best.matched < required) return null;
  return boxesByLine(words, stream[best.first]!.word, stream[best.last]!.word);
}

/**
 * Walks the target words in order through the stream, allowing small gaps.
 * OCR sometimes runs two printed words together ("80PROOF"), so one stream
 * token may match two target words.
 */
function alignFrom(stream: Token[], start: number, target: string[]) {
  const limit = Math.min(stream.length, start + Math.ceil(target.length * 1.5) + 2);
  let position = start;
  let matched = 0;
  let last = start;
  for (let t = 0; t < target.length; t++) {
    const token = target[t]!;
    const joined = token + (target[t + 1] ?? '');
    for (let probe = position; probe < Math.min(limit, position + 3); probe++) {
      const value = stream[probe]!.value;
      if (t + 1 < target.length && tokensMatch(value, joined)) {
        matched += 2;
        t += 1;
      } else if (tokensMatch(value, token)) {
        matched += 1;
      } else {
        continue;
      }
      last = probe;
      position = probe + 1;
      break;
    }
  }
  return matched > 0 ? { matched, first: start, last } : null;
}

function meanHeight(
  words: readonly OcrWord[],
  firstWord: number,
  lastWord: number,
): number {
  const span = words.slice(firstWord, lastWord + 1);
  return (
    span.reduce((sum, word) => sum + (word.bbox.y1 - word.bbox.y0), 0) /
    Math.max(1, span.length)
  );
}

function boxesByLine(
  words: readonly OcrWord[],
  firstWord: number,
  lastWord: number,
): Box[] {
  const byLine = new Map<number, Box>();
  for (const word of words.slice(firstWord, lastWord + 1)) {
    const current = byLine.get(word.line);
    byLine.set(word.line, current ? union(current, word.bbox) : { ...word.bbox });
  }
  return [...byLine.values()];
}

function union(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Characters OCR commonly swaps; folded the same way on both sides before comparing. */
const OCR_LOOKALIKES: Record<string, string> = {
  o: '0',
  l: '1',
  i: '1',
  s: '5',
  b: '8',
  z: '2',
};

function foldLookalikes(token: string): string {
  return token.replace(/[olisbz]/g, (c) => OCR_LOOKALIKES[c]!);
}

/** Equal (allowing look-alike characters like 8/B), or one edit apart for longer words. */
function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  a = foldLookalikes(a);
  b = foldLookalikes(b);
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  return withinOneEdit(a, b);
}

function withinOneEdit(a: string, b: string): boolean {
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

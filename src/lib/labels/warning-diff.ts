/**
 * Word-level diff between canonical and extracted Government Warning text.
 *
 * Pure function, no DOM. Returns a flat list of segments — the renderer
 * paints them with appropriate styling. Word granularity is more readable than
 * character-level for the Government Warning's mostly-prose shape.
 *
 * Reconstructibility invariant: concatenating equal+extra segments equals
 * the extracted input; concatenating equal+missing segments equals canonical.
 */

export type DiffSegment =
  | { kind: 'equal'; text: string }
  | { kind: 'missing'; text: string } // present in canonical, absent from extracted
  | { kind: 'extra'; text: string }; // present in extracted, absent from canonical

interface Token {
  text: string; // includes trailing whitespace
}

function tokenize(input: string): Token[] {
  if (input.length === 0) return [];
  // Match a word (non-whitespace) followed by optional whitespace.
  const matches = input.match(/\S+\s*/g);
  return (matches ?? []).map((text) => ({ text }));
}

function lcs(a: Token[], b: Token[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1]!.text === b[j - 1]!.text) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
      } else {
        table[i]![j] = Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
  }
  return table;
}

export function diffWarning(canonical: string, extracted: string): DiffSegment[] {
  const a = tokenize(canonical);
  const b = tokenize(extracted);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ kind: 'extra', text: extracted }];
  if (b.length === 0) return [{ kind: 'missing', text: canonical }];

  const table = lcs(a, b);
  const out: DiffSegment[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1]!.text === b[j - 1]!.text) {
      out.push({ kind: 'equal', text: a[i - 1]!.text });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i]![j - 1]! >= table[i - 1]![j]!)) {
      out.push({ kind: 'extra', text: b[j - 1]!.text });
      j -= 1;
    } else if (i > 0) {
      out.push({ kind: 'missing', text: a[i - 1]!.text });
      i -= 1;
    }
  }
  out.reverse();
  return mergeAdjacent(out);
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

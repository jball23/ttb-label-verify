/**
 * Newline-delimited JSON utilities.
 *
 * Server side: `encodeNDJSON(obj)` returns a JSON line ready to enqueue.
 * Client side: `parseNDJSONStream(reader)` yields one parsed value per line,
 * buffering across chunk boundaries.
 */

export function encodeNDJSON(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export interface ParseLine<T> {
  kind: 'value' | 'parse-error';
  value?: T;
  raw?: string;
  error?: string;
}

/**
 * Read an NDJSON stream and yield parsed lines.
 *
 * Lines that fail to parse yield a `{kind: 'parse-error'}` entry rather than
 * throwing — one bad line shouldn't kill the batch. Validation against a
 * concrete schema is the caller's job (see `results/stream-consumer.ts`).
 */
export async function* parseNDJSONStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ParseLine<unknown>> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        yield parseLine(line);
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    yield parseLine(buffer);
  }
}

function parseLine(line: string): ParseLine<unknown> {
  try {
    return { kind: 'value', value: JSON.parse(line) };
  } catch (e) {
    return { kind: 'parse-error', raw: line, error: (e as Error).message };
  }
}

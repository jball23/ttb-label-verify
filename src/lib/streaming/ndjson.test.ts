import { describe, it, expect } from 'vitest';
import { encodeNDJSON, parseNDJSONStream } from './ndjson';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i += 1;
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('encodeNDJSON', () => {
  it('appends a newline', () => {
    expect(encodeNDJSON({ a: 1 })).toBe('{"a":1}\n');
  });
});

describe('parseNDJSONStream', () => {
  it('yields one value per complete line', async () => {
    const stream = streamFromChunks(['{"a":1}\n{"a":2}\n']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([
      { kind: 'value', value: { a: 1 } },
      { kind: 'value', value: { a: 2 } },
    ]);
  });

  it('reassembles a JSON object split across chunks', async () => {
    const stream = streamFromChunks(['{"a":', '1}\n']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([{ kind: 'value', value: { a: 1 } }]);
  });

  it('reassembles when a newline arrives in a later chunk', async () => {
    const stream = streamFromChunks(['{"a":1}', '\n{"a":2}\n']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([
      { kind: 'value', value: { a: 1 } },
      { kind: 'value', value: { a: 2 } },
    ]);
  });

  it('returns parse-error for malformed JSON without throwing', async () => {
    const stream = streamFromChunks(['{not json\n{"a":1}\n']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('parse-error');
    expect(result[0]?.raw).toBe('{not json');
    expect(result[1]).toEqual({ kind: 'value', value: { a: 1 } });
  });

  it('ignores empty trailing lines', async () => {
    const stream = streamFromChunks(['{"a":1}\n\n']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([{ kind: 'value', value: { a: 1 } }]);
  });

  it('handles a final line without a trailing newline', async () => {
    const stream = streamFromChunks(['{"a":1}\n{"a":2}']);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([
      { kind: 'value', value: { a: 1 } },
      { kind: 'value', value: { a: 2 } },
    ]);
  });

  it('yields nothing for an empty stream', async () => {
    const stream = streamFromChunks([]);
    const result = await collect(parseNDJSONStream(stream.getReader()));
    expect(result).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { consumeResultStream } from './stream-consumer';
import { encodeNDJSON } from '../streaming/ndjson';
import { type ResultLine } from './result-types';

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

const VALID_OK_LINE: ResultLine = {
  status: 'ok',
  index: 0,
  filename: 'a.jpg',
  durationMs: 1000,
  report: {
    overallStatus: 'compliant',
    crossCheck: { overallStatus: 'match', fields: {} },
    fields: {}, provenance: {},
  },
};

describe('consumeResultStream', () => {
  it('yields valid ResultLine entries from a well-formed stream', async () => {
    const body = encodeNDJSON(VALID_OK_LINE);
    const result = await collect(consumeResultStream(streamFromString(body).getReader()));
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('value');
    if (result[0]?.kind === 'value') {
      expect(result[0].value.filename).toBe('a.jpg');
    }
  });

  it('yields parse-error for malformed JSON without stopping', async () => {
    const body = `not json\n${encodeNDJSON(VALID_OK_LINE)}`;
    const result = await collect(consumeResultStream(streamFromString(body).getReader()));
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('parse-error');
    expect(result[1]?.kind).toBe('value');
  });

  it('yields schema-error for valid JSON that does not match the schema', async () => {
    const body = encodeNDJSON({ status: 'ok', filename: 'x' }); // missing fields
    const result = await collect(consumeResultStream(streamFromString(body).getReader()));
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('schema-error');
  });

  it('yields nothing for an empty stream', async () => {
    const result = await collect(consumeResultStream(streamFromString('').getReader()));
    expect(result).toEqual([]);
  });
});

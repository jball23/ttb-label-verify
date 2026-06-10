import { parseNDJSONStream } from '../streaming/ndjson';
import { ResultLineSchema, type ResultLine } from './result-types';

export type ConsumerEntry =
  | { kind: 'value'; value: ResultLine }
  | { kind: 'parse-error'; raw: string; error: string }
  | { kind: 'schema-error'; raw: unknown; error: string };

/**
 * Consume an NDJSON stream from /api/verify and yield typed entries.
 *
 * Malformed JSON or schema-violating lines yield typed `*-error` entries
 * instead of throwing — one bad line shouldn't kill the rendering of the rest.
 */
export async function* consumeResultStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ConsumerEntry> {
  for await (const line of parseNDJSONStream(reader)) {
    if (line.kind === 'parse-error') {
      yield {
        kind: 'parse-error',
        raw: line.raw ?? '',
        error: line.error ?? 'unknown',
      };
      continue;
    }
    const result = ResultLineSchema.safeParse(line.value);
    if (!result.success) {
      yield {
        kind: 'schema-error',
        raw: line.value,
        error: result.error.message,
      };
      continue;
    }
    yield { kind: 'value', value: result.data };
  }
}

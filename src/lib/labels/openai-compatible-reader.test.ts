import type OpenAI from 'openai';
import { APIConnectionTimeoutError, AuthenticationError, RateLimitError } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { ReaderAuthError, ReaderRateLimitError, ReaderResponseError, ReaderTimeoutError } from './errors';
import { compliantReading } from './fake-label-reader';
import { type LabelImage } from './label-reader';
import { OpenAICompatibleReader } from './openai-compatible-reader';

const image: LabelImage = { bytes: Buffer.from('label'), mimeType: 'image/webp' };

function readerWith(parse: ReturnType<typeof vi.fn>) {
  const client = { chat: { completions: { parse } } } as unknown as OpenAI;
  return new OpenAICompatibleReader({ client, model: 'test-model', provider: 'openai', rateLimitRetries: 0 });
}

describe('OpenAICompatibleReader', () => {
  it('sends the image with its real MIME type and returns the parsed reading', async () => {
    const reading = compliantReading();
    const parse = vi.fn().mockResolvedValue({ choices: [{ message: { parsed: reading } }] });
    await expect(readerWith(parse).read(image)).resolves.toEqual(reading);

    const [body] = parse.mock.calls[0]!;
    const imagePart = body.messages[1].content[1];
    expect(imagePart.image_url.url).toBe(`data:image/webp;base64,${Buffer.from('label').toString('base64')}`);
    expect(body.model).toBe('test-model');
  });

  it('identifies its provider and model', () => {
    expect(readerWith(vi.fn()).modelId).toBe('openai:test-model');
  });

  it.each([
    ['an auth failure', new AuthenticationError(401, {}, 'bad key', new Headers()), ReaderAuthError],
    ['a rate limit', new RateLimitError(429, {}, 'slow down', new Headers()), ReaderRateLimitError],
    ['a timeout', new APIConnectionTimeoutError(), ReaderTimeoutError],
    ['anything else', new Error('boom'), ReaderResponseError],
  ])('maps %s to a typed error', async (_name, thrown, expected) => {
    const parse = vi.fn().mockRejectedValue(thrown);
    await expect(readerWith(parse).read(image)).rejects.toBeInstanceOf(expected);
  });

  it('turns blank answers into "not on the label"', async () => {
    const reading = compliantReading();
    reading.fields.countryOfOrigin = { value: '  ', confidence: 'high' };
    reading.governmentWarning.verbatimText = '';
    const parse = vi.fn().mockResolvedValue({ choices: [{ message: { parsed: reading } }] });
    const result = await readerWith(parse).read(image);
    expect(result.fields.countryOfOrigin.value).toBeNull();
    expect(result.governmentWarning.verbatimText).toBeNull();
  });

  it('treats an empty structured response as a reader failure', async () => {
    const parse = vi.fn().mockResolvedValue({ choices: [{ message: { parsed: null } }] });
    await expect(readerWith(parse).read(image)).rejects.toBeInstanceOf(ReaderResponseError);
  });
});

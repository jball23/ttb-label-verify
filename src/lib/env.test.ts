import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('defaults to the OpenAI reader with a 15 s timeout', () => {
    const env = parseEnv({});
    expect(env.LABEL_READER).toBe('openai');
    expect(env.LABEL_READER_TIMEOUT_MS).toBe(15000);
    expect(env.AZURE_OPENAI_API_VERSION).toBe('2024-10-21');
  });

  it('accepts an Azure OpenAI configuration', () => {
    const env = parseEnv({
      LABEL_READER: 'azure-openai',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_OPENAI_DEPLOYMENT: 'label-reader',
    });
    expect(env.AZURE_OPENAI_DEPLOYMENT).toBe('label-reader');
  });

  it.each([
    [{ LABEL_READER: 'tesseract' }, /LABEL_READER/],
    [{ LABEL_READER_TIMEOUT_MS: '50' }, /LABEL_READER_TIMEOUT_MS/],
    [{ OPENAI_REASONING_EFFORT: 'max' }, /OPENAI_REASONING_EFFORT/],
    [{ DATABASE_URL: 'not a url' }, /DATABASE_URL/],
  ])('rejects %j', (source, message) => {
    expect(() => parseEnv(source)).toThrow(message);
  });

  // Vercel pulls an unset variable as an empty string.
  it('treats empty variables as unset', () => {
    const env = parseEnv({ DATABASE_URL: '', LABEL_READER: '', OPENAI_REASONING_EFFORT: '', LABEL_READER_TIMEOUT_MS: '' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.LABEL_READER).toBe('openai');
    expect(env.OPENAI_REASONING_EFFORT).toBeUndefined();
  });

  it('accepts Langfuse vars when provided', () => {
    const env = parseEnv({ LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' });
    expect(env.LANGFUSE_PUBLIC_KEY).toBe('pk-lf-test');
  });
});

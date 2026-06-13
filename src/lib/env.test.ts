import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('accepts a fully-populated openai config', () => {
    const env = parseEnv({
      LABEL_EXTRACTOR: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_VLM_MODEL: 'gpt-5.4-mini',
    });
    expect(env.LABEL_EXTRACTOR).toBe('openai');
    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(env.OPENAI_VLM_MODEL).toBe('gpt-5.4-mini');
  });

  it('defaults LABEL_EXTRACTOR to tesseract when unset', () => {
    const env = parseEnv({ OPENAI_API_KEY: 'sk-test' });
    expect(env.LABEL_EXTRACTOR).toBe('tesseract');
    expect(env.OPENAI_MAX_CONCURRENT_REQUESTS).toBe(4);
    expect(env.OPENAI_MAX_RETRIES).toBe(4);
  });

  it('accepts OpenAI throttle overrides', () => {
    const env = parseEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MAX_CONCURRENT_REQUESTS: '2',
      OPENAI_MAX_RETRIES: '6',
    });
    expect(env.OPENAI_MAX_CONCURRENT_REQUESTS).toBe(2);
    expect(env.OPENAI_MAX_RETRIES).toBe(6);
  });

  it('rejects invalid OpenAI throttle values', () => {
    expect(() =>
      parseEnv({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MAX_CONCURRENT_REQUESTS: '0',
      }),
    ).toThrow(/OPENAI_MAX_CONCURRENT_REQUESTS/);
  });

  it('throws when OPENAI_API_KEY is missing for openai extractor', () => {
    expect(() => parseEnv({ LABEL_EXTRACTOR: 'openai' })).toThrow(
      /OPENAI_API_KEY is required/,
    );
  });

  it('throws when AZURE_OPENAI_ENDPOINT is missing for azure-openai extractor', () => {
    expect(() =>
      parseEnv({
        LABEL_EXTRACTOR: 'azure-openai',
        AZURE_OPENAI_API_KEY: 'k',
      }),
    ).toThrow(/AZURE_OPENAI_ENDPOINT is required/);
  });

  it('throws when AZURE_OPENAI_API_KEY is missing for azure-openai extractor', () => {
    expect(() =>
      parseEnv({
        LABEL_EXTRACTOR: 'azure-openai',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      }),
    ).toThrow(/AZURE_OPENAI_API_KEY is required/);
  });

  it('accepts Langfuse vars as optional', () => {
    const env = parseEnv({ OPENAI_API_KEY: 'sk-test' });
    expect(env.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(env.LANGFUSE_SECRET_KEY).toBeUndefined();
  });

  it('accepts Langfuse vars when provided', () => {
    const env = parseEnv({
      OPENAI_API_KEY: 'sk-test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
      LANGFUSE_HOST: 'https://cloud.langfuse.com',
    });
    expect(env.LANGFUSE_PUBLIC_KEY).toBe('pk-lf-test');
  });
});

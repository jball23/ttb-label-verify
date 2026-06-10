import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

const REQUIRED_BASE = {
  DEMO_PASSWORD: 'demo-password',
  DEMO_PASSWORD_COOKIE_SECRET: 'a'.repeat(32),
};

describe('parseEnv', () => {
  it('accepts a fully-populated openai config', () => {
    const env = parseEnv({
      ...REQUIRED_BASE,
      LABEL_EXTRACTOR: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(env.LABEL_EXTRACTOR).toBe('openai');
    expect(env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('defaults LABEL_EXTRACTOR to openai when unset', () => {
    const env = parseEnv({
      ...REQUIRED_BASE,
      OPENAI_API_KEY: 'sk-test',
    });
    expect(env.LABEL_EXTRACTOR).toBe('openai');
  });

  it('throws when OPENAI_API_KEY is missing for openai extractor', () => {
    expect(() =>
      parseEnv({
        ...REQUIRED_BASE,
        LABEL_EXTRACTOR: 'openai',
      }),
    ).toThrow(/OPENAI_API_KEY is required/);
  });

  it('throws when AZURE_OPENAI_ENDPOINT is missing for azure-openai extractor', () => {
    expect(() =>
      parseEnv({
        ...REQUIRED_BASE,
        LABEL_EXTRACTOR: 'azure-openai',
        AZURE_OPENAI_API_KEY: 'k',
      }),
    ).toThrow(/AZURE_OPENAI_ENDPOINT is required/);
  });

  it('throws when AZURE_OPENAI_API_KEY is missing for azure-openai extractor', () => {
    expect(() =>
      parseEnv({
        ...REQUIRED_BASE,
        LABEL_EXTRACTOR: 'azure-openai',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      }),
    ).toThrow(/AZURE_OPENAI_API_KEY is required/);
  });

  it('throws when DEMO_PASSWORD is missing', () => {
    expect(() =>
      parseEnv({
        DEMO_PASSWORD_COOKIE_SECRET: 'a'.repeat(32),
        OPENAI_API_KEY: 'sk-test',
      }),
    ).toThrow(/DEMO_PASSWORD/);
  });

  it('throws when DEMO_PASSWORD_COOKIE_SECRET is too short', () => {
    expect(() =>
      parseEnv({
        DEMO_PASSWORD: 'pw',
        DEMO_PASSWORD_COOKIE_SECRET: 'short',
        OPENAI_API_KEY: 'sk-test',
      }),
    ).toThrow(/at least 16 characters/);
  });

  it('accepts Langfuse vars as optional', () => {
    const env = parseEnv({
      ...REQUIRED_BASE,
      OPENAI_API_KEY: 'sk-test',
    });
    expect(env.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(env.LANGFUSE_SECRET_KEY).toBeUndefined();
  });

  it('accepts Langfuse vars when provided', () => {
    const env = parseEnv({
      ...REQUIRED_BASE,
      OPENAI_API_KEY: 'sk-test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
      LANGFUSE_HOST: 'https://cloud.langfuse.com',
    });
    expect(env.LANGFUSE_PUBLIC_KEY).toBe('pk-lf-test');
  });
});

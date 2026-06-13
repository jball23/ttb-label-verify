import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvForTesting } from '../env';

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvForTesting();
}

describe('getExtractor', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    resetEnvForTesting();
  });

  it('returns an OpenAIExtractor when LABEL_EXTRACTOR=openai', async () => {
    setEnv({
      LABEL_EXTRACTOR: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_VLM_MODEL: 'gpt-5.4-mini',
      DEMO_PASSWORD: 'pw',
      DEMO_PASSWORD_COOKIE_SECRET: 'a'.repeat(32),
    });
    const { getExtractor } = await import('./factory');
    const extractor = getExtractor();
    expect(extractor.providerName).toBe('openai');
    expect(extractor.modelId).toBe('gpt-5.4-mini');
  });

  it('returns an AzureOpenAIExtractor when LABEL_EXTRACTOR=azure-openai', async () => {
    setEnv({
      LABEL_EXTRACTOR: 'azure-openai',
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'k',
      DEMO_PASSWORD: 'pw',
      DEMO_PASSWORD_COOKIE_SECRET: 'a'.repeat(32),
    });
    const { getExtractor } = await import('./factory');
    const extractor = getExtractor();
    expect(extractor.providerName).toBe('azure-openai');
  });

  it('AzureOpenAIExtractor.extract() throws NotImplementedError', async () => {
    setEnv({
      LABEL_EXTRACTOR: 'azure-openai',
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'k',
      DEMO_PASSWORD: 'pw',
      DEMO_PASSWORD_COOKIE_SECRET: 'a'.repeat(32),
    });
    const { getExtractor } = await import('./factory');
    const extractor = getExtractor();
    await expect(
      extractor.extract([{ pageNumber: 1, kind: 'form', png: Buffer.from('x') }]),
    ).rejects.toThrow(
      /NotImplementedError|not implemented/,
    );
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetEnvForTesting } from '../env';
import {
  getLangfuseClient,
  getObservedOpenAI,
  resetObservabilityForTesting,
} from './langfuse';

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
  resetObservabilityForTesting();
}

describe('observability/langfuse', () => {
  beforeEach(() => {
    setEnv({ OPENAI_API_KEY: 'sk-test' });
  });

  afterEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    resetEnvForTesting();
    resetObservabilityForTesting();
  });

  it('getLangfuseClient returns null when Langfuse keys are absent', () => {
    expect(getLangfuseClient()).toBeNull();
  });

  it('getObservedOpenAI returns a usable client when Langfuse keys are absent', () => {
    const client = getObservedOpenAI('sk-test');
    expect(client).toBeDefined();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('getLangfuseClient returns a client when all keys are set', () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
      LANGFUSE_HOST: 'https://cloud.langfuse.com',
    });
    const client = getLangfuseClient();
    expect(client).not.toBeNull();
  });

  it('getObservedOpenAI returns a usable client when Langfuse keys are set', () => {
    setEnv({
      OPENAI_API_KEY: 'sk-test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
    });
    const client = getObservedOpenAI('sk-test');
    expect(client).toBeDefined();
    expect(typeof client.chat.completions.create).toBe('function');
  });
});

describe('observability/spans', () => {
  beforeEach(() => {
    setEnv({ OPENAI_API_KEY: 'sk-test' });
  });

  afterEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    resetEnvForTesting();
    resetObservabilityForTesting();
  });

  it('withRequestSpan invokes fn and returns its result when Langfuse is disabled', async () => {
    const { withRequestSpan } = await import('./spans');
    const result = await withRequestSpan(
      'verify-request',
      { labelCount: 1, promptVersion: 'v1' },
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });

  it('withLabelSpan invokes fn and returns its result when Langfuse is disabled', async () => {
    const { withLabelSpan } = await import('./spans');
    const result = await withLabelSpan(
      {
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        byteSize: 1234,
        imageSha256: 'deadbeef',
      },
      async () => ({ extractionConfidence: 'high' as const }),
    );
    expect(result.extractionConfidence).toBe('high');
  });

  it('withRequestSpan propagates errors from the wrapped fn', async () => {
    const { withRequestSpan } = await import('./spans');
    await expect(
      withRequestSpan(
        'verify-request',
        { labelCount: 1, promptVersion: 'v1' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
  });
});

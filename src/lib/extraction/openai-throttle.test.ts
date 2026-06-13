import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTesting } from '../env';
import {
  resetOpenAIThrottleForTesting,
  retryRateLimitedRequest,
  runOpenAIRequest,
} from './openai-throttle';

const ORIGINAL_ENV = { ...process.env };

function resetTestState(): void {
  Object.assign(process.env, ORIGINAL_ENV);
  delete process.env.OPENAI_MAX_CONCURRENT_REQUESTS;
  delete process.env.OPENAI_MAX_RETRIES;
  resetEnvForTesting();
  resetOpenAIThrottleForTesting();
}

describe('openai-throttle', () => {
  beforeEach(() => {
    resetTestState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetTestState();
  });

  it('retries provider rate limits with retry-after-ms', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('too many requests'), {
          status: 429,
          headers: { 'retry-after-ms': '10' },
        }),
      )
      .mockResolvedValueOnce('ok');

    const promise = retryRateLimitedRequest(request, {
      maxRetries: 1,
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-rate-limit errors', async () => {
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error('bad request'));

    await expect(
      retryRateLimitedRequest(request, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }),
    ).rejects.toThrow(/bad request/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('queues OpenAI requests behind the configured concurrency gate', async () => {
    vi.useFakeTimers();
    process.env.OPENAI_MAX_CONCURRENT_REQUESTS = '1';
    process.env.OPENAI_MAX_RETRIES = '0';
    resetEnvForTesting();
    resetOpenAIThrottleForTesting();

    let active = 0;
    let maxActive = 0;
    const run = (value: string): Promise<string> =>
      runOpenAIRequest(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return value;
      });

    const all = Promise.all([run('a'), run('b'), run('c')]);
    await vi.advanceTimersByTimeAsync(75);

    await expect(all).resolves.toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
  });
});

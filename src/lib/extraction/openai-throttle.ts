import { getEnv } from '../env';

const DEFAULT_BASE_DELAY_MS = 1_500;
const DEFAULT_MAX_DELAY_MS = 15_000;

type QueuedTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<QueuedTask<unknown>> = [];

  constructor(private readonly concurrency: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const task = this.queue.shift();
      if (!task) return;

      this.active += 1;
      task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

let limiter: AsyncLimiter | null = null;
let limiterConcurrency: number | null = null;

export async function runOpenAIRequest<T>(request: () => Promise<T>): Promise<T> {
  const env = getEnv();
  const current = getLimiter(env.OPENAI_MAX_CONCURRENT_REQUESTS);
  return current.run(() =>
    retryRateLimitedRequest(request, {
      maxRetries: env.OPENAI_MAX_RETRIES,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
    }),
  );
}

function getLimiter(concurrency: number): AsyncLimiter {
  if (!limiter || limiterConcurrency !== concurrency) {
    limiter = new AsyncLimiter(concurrency);
    limiterConcurrency = concurrency;
  }
  return limiter;
}

export async function retryRateLimitedRequest<T>(
  request: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  },
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await request();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= options.maxRetries) {
        throw error;
      }
      await sleep(getRetryDelayMs(error, attempt, options));
      attempt += 1;
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
  if (err.status === 429) return true;
  const haystack = [err.code, err.type, err.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return /rate.?limit|429/i.test(haystack);
}

function getRetryDelayMs(
  error: unknown,
  attempt: number,
  options: {
    baseDelayMs: number;
    maxDelayMs: number;
  },
): number {
  const retryAfterMs = readRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.min(options.maxDelayMs, Math.max(0, retryAfterMs));
  }

  const exponential = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** attempt,
  );
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as { headers?: unknown; response?: { headers?: unknown } })
    .headers ?? (error as { response?: { headers?: unknown } }).response?.headers;

  const retryAfterMs = readHeader(headers, 'retry-after-ms');
  if (retryAfterMs) {
    const parsed = Number(retryAfterMs);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const retryAfter = readHeader(headers, 'retry-after');
  if (!retryAfter) return null;
  const parsed = Number(retryAfter);
  return Number.isFinite(parsed) ? parsed * 1000 : null;
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get(name);
    return typeof value === 'string' ? value : null;
  }
  if (typeof headers === 'object') {
    const record = headers as Record<string, unknown>;
    const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
    return typeof direct === 'string' ? direct : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resetOpenAIThrottleForTesting(): void {
  limiter = null;
  limiterConcurrency = null;
}

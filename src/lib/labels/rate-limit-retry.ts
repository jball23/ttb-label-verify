/**
 * Retries a provider call when it is rate limited (HTTP 429), honouring the
 * provider's Retry-After hint when present. Any other error is rethrown at once.
 */
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

  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers =
    (error as { headers?: unknown; response?: { headers?: unknown } }).headers ??
    (error as { response?: { headers?: unknown } }).response?.headers;

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
    const direct =
      record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
    return typeof direct === 'string' ? direct : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

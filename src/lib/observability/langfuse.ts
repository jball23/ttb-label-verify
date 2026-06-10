import { Langfuse } from 'langfuse';
import { observeOpenAI } from 'langfuse';
import OpenAI from 'openai';
import { getEnv } from '../env';

/**
 * Langfuse client and OpenAI observation wrapper.
 *
 * Both are no-ops when LANGFUSE_PUBLIC_KEY is absent — the demo runs unchanged
 * without observability configured. A Langfuse outage or misconfiguration must
 * never propagate to user-visible behavior.
 */

let cachedClient: Langfuse | null = null;
let observationDisabled: boolean | null = null;

function isObservationEnabled(): boolean {
  if (observationDisabled !== null) return !observationDisabled;
  const env = getEnv();
  observationDisabled = !env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY;
  return !observationDisabled;
}

export function getLangfuseClient(): Langfuse | null {
  if (!isObservationEnabled()) return null;
  if (cachedClient) return cachedClient;
  const env = getEnv();
  cachedClient = new Langfuse({
    publicKey: env.LANGFUSE_PUBLIC_KEY!,
    secretKey: env.LANGFUSE_SECRET_KEY!,
    baseUrl: env.LANGFUSE_HOST,
  });
  return cachedClient;
}

/**
 * Returns an OpenAI client wrapped with Langfuse observation when keys are set,
 * or a plain OpenAI client otherwise. Drop-in replacement for `new OpenAI()`.
 */
export function getObservedOpenAI(apiKey: string): OpenAI {
  const plain = new OpenAI({ apiKey });
  if (!isObservationEnabled()) return plain;
  try {
    // observeOpenAI returns a Proxy that adds tracing — type matches OpenAI's surface.
    return observeOpenAI(plain) as unknown as OpenAI;
  } catch (e) {
    // Never let observability bring down the extractor.
    console.warn(
      `[observability] observeOpenAI failed, falling back to plain client: ${(e as Error).message}`,
    );
    return plain;
  }
}

/**
 * Test-only reset for the memoized state.
 */
export function resetObservabilityForTesting(): void {
  cachedClient = null;
  observationDisabled = null;
}

import { getLangfuseClient } from './langfuse';

/**
 * Span helpers for tracing the verify request and per-label work.
 *
 * Every helper swallows Langfuse errors — a tracing outage produces missing
 * traces, never a user-visible failure. Helpers are no-ops when Langfuse is
 * not configured.
 */

export interface RequestSpanMetadata {
  labelCount: number;
  promptVersion: string;
  model?: string;
}

export interface LabelSpanMetadata {
  filename: string;
  mimeType: string;
  byteSize: number;
  imageSha256: string;
}

export async function withRequestSpan<T>(
  name: string,
  metadata: RequestSpanMetadata,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getLangfuseClient();
  if (!client) return fn();

  let trace;
  try {
    trace = client.trace({ name, metadata });
  } catch (e) {
    console.warn(
      `[observability] failed to start request span: ${(e as Error).message}`,
    );
    return fn();
  }

  const start = Date.now();
  try {
    const result = await fn();
    safeUpdateTrace(trace, { durationMs: Date.now() - start });
    return result;
  } catch (e) {
    safeUpdateTrace(trace, {
      durationMs: Date.now() - start,
      error: (e as Error).message,
    });
    throw e;
  } finally {
    try {
      await client.flushAsync();
    } catch {
      // Flush failures are non-fatal.
    }
  }
}

export async function withLabelSpan<T>(
  metadata: LabelSpanMetadata,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getLangfuseClient();
  if (!client) return fn();

  let span;
  try {
    span = client.span({ name: 'extract-label', input: metadata });
  } catch (e) {
    console.warn(
      `[observability] failed to start label span: ${(e as Error).message}`,
    );
    return fn();
  }

  const start = Date.now();
  try {
    const result = await fn();
    safeEndSpan(span, { durationMs: Date.now() - start, output: redactOutput(result) });
    return result;
  } catch (e) {
    safeEndSpan(span, {
      durationMs: Date.now() - start,
      error: (e as Error).message,
    });
    throw e;
  }
}

// Don't put the full extraction into the span output — keep traces lightweight.
// We surface key shape info (confidence, presence of fields).
function redactOutput<T>(result: T): unknown {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    return {
      extractionConfidence: obj.extractionConfidence,
      fieldsPresent: Object.entries(obj)
        .filter(([k, v]) => k !== 'extractionConfidence' && v !== null)
        .map(([k]) => k),
    };
  }
  return null;
}

function safeUpdateTrace(trace: unknown, data: Record<string, unknown>): void {
  try {
    (trace as { update?: (d: Record<string, unknown>) => void }).update?.(data);
  } catch {
    /* swallow */
  }
}

function safeEndSpan(span: unknown, data: Record<string, unknown>): void {
  try {
    (span as { end?: (d: Record<string, unknown>) => void }).end?.(data);
  } catch {
    /* swallow */
  }
}

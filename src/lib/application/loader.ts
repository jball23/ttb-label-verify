import { z } from 'zod';
import { ApplicationSchema } from './types';
import type { Application } from './types';

/**
 * Thrown when an application payload fails Zod validation. Carries the formatted
 * Zod error message so the verify route can surface a useful 400 to the client
 * without leaking schema internals.
 */
export class InvalidApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApplicationError';
  }
}

/**
 * Parse and validate an unknown payload as a COLA Application.
 *
 * The verify route calls this on the `application` multipart form field after
 * JSON-decoding. The demo scenario picker (client-side) calls it after fetching
 * `/samples/applications/0N-*` so a corrupted fixture fails before populating
 * the upload state.
 */
export function parseApplication(input: unknown): Application {
  const result = ApplicationSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidApplicationError(formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    lines.push(path + ': ' + issue.message);
  }
  return 'Application JSON failed validation:\n' + lines.join('\n');
}

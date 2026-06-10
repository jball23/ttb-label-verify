/**
 * Scrub secrets from error messages before they're sent to the client.
 *
 * Defense in depth: provider SDKs occasionally embed the request headers
 * (including the bearer token) in error messages. Without scrubbing, that
 * leaks straight to the UI in the result card's error message.
 *
 * This is a deny-list approach — we know the shapes of secrets we handle and
 * mask them aggressively. Better to mangle a few non-secret error strings than
 * to risk a leak.
 */

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI keys: sk-..., sk-proj-..., sk-svcacct-...
  /sk-(?:proj-|svcacct-|None-|live-)?[A-Za-z0-9_\-]{20,}/g,
  // Bearer tokens in stringified headers
  /Bearer\s+[A-Za-z0-9_\-.+/=]{20,}/gi,
  // Authorization header dumps
  /Authorization:\s*[^\s,"}]+/gi,
  // Anthropic-style keys (in case the swap is partial)
  /sk-ant-[A-Za-z0-9_\-]{20,}/g,
  // Azure-style api-key headers
  /api-key:\s*[A-Za-z0-9_\-]+/gi,
];

const REDACTED = '[REDACTED]';

export function scrubError(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

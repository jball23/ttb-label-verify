import { describe, it, expect } from 'vitest';
import { scrubError } from './scrub-error';

describe('scrubError', () => {
  it('redacts an OpenAI sk-proj key', () => {
    const msg =
      'Headers.append: "Bearer sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG" is invalid';
    expect(scrubError(msg)).not.toContain('sk-proj-');
    expect(scrubError(msg)).toContain('[REDACTED]');
  });

  it('redacts a plain OpenAI sk- key', () => {
    const msg = 'Auth failed: sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEFG';
    expect(scrubError(msg)).not.toMatch(/sk-[a-zA-Z]/);
  });

  it('redacts an Anthropic sk-ant- key', () => {
    const msg = 'Header: sk-ant-1234567890abcdefghijklmnopqrstuvwxyz';
    expect(scrubError(msg)).not.toContain('sk-ant-');
  });

  it('redacts a Bearer token', () => {
    const msg = 'Bearer abcdefghijklmnopqrstuvwxyz1234567890 is invalid';
    expect(scrubError(msg)).toContain('[REDACTED]');
    expect(scrubError(msg)).not.toContain('abcdefghijklmnop');
  });

  it('redacts an Authorization header dump', () => {
    const msg = 'Bad request: Authorization: Bearer xyz12345abcdef67890ghijkl';
    const result = scrubError(msg);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('xyz12345abcdef');
  });

  it('redacts an Azure api-key header', () => {
    const msg = 'request had api-key: abc123def456ghi789';
    expect(scrubError(msg)).toContain('[REDACTED]');
  });

  it('leaves a normal error message untouched', () => {
    const msg = 'The image is too blurry to read reliably.';
    expect(scrubError(msg)).toBe(msg);
  });

  it('leaves short non-secret tokens alone (no false positives on short hashes)', () => {
    const msg = 'Request id: abc123 failed.';
    expect(scrubError(msg)).toBe(msg);
  });

  it('handles multiple secrets in the same message', () => {
    const msg =
      'Bearer sk-proj-aaaaaaaaaaaaaaaaaaaa1234 and Authorization: token-bbbbbbbbbbbbbbbbbbbbbbbb';
    const result = scrubError(msg);
    expect(result).not.toContain('sk-proj-aaa');
    expect(result).not.toContain('token-bbb');
    expect((result.match(/\[REDACTED\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

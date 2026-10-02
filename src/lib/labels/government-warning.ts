import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  normalizeWhitespace,
} from '../validation/ttb-constants';

/**
 * Exact-text analysis of a transcribed Health Warning Statement (27 CFR
 * §16.21–16.22). The statement must appear word for word, and the words
 * "GOVERNMENT WARNING" must be in capital letters. Only whitespace is
 * normalized — capitalization, wording and punctuation are compared exactly.
 */
export type WarningFinding =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'prefix_missing' }
  | { kind: 'prefix_not_exact'; prefixAsPrinted: string }
  | { kind: 'wording_differs' };

const CANONICAL_BODY = normalizeWhitespace(
  GOVERNMENT_WARNING_CANONICAL.slice(GOVERNMENT_WARNING_PREFIX.length),
);
// Finds the lead-in in any capitalization so we can report HOW it is wrong.
const PREFIX_ANY_CASE_RE = /government\s+warning\s*:?/i;

export function analyzeGovernmentWarning(text: string | null): WarningFinding[] {
  if (!text || !text.trim()) return [{ kind: 'missing' }];
  const normalized = normalizeWhitespace(text);
  const prefix = PREFIX_ANY_CASE_RE.exec(normalized);
  if (!prefix) {
    // Without the lead-in, the body may still be checked word for word.
    return normalized === CANONICAL_BODY
      ? [{ kind: 'prefix_missing' }]
      : [{ kind: 'prefix_missing' }, { kind: 'wording_differs' }];
  }

  const findings: WarningFinding[] = [];
  const prefixAsPrinted = normalizeWhitespace(prefix[0]);
  if (prefixAsPrinted !== GOVERNMENT_WARNING_PREFIX) {
    findings.push({ kind: 'prefix_not_exact', prefixAsPrinted });
  }
  const body = normalizeWhitespace(normalized.slice(prefix.index + prefix[0].length));
  if (body !== CANONICAL_BODY) findings.push({ kind: 'wording_differs' });
  return findings.length > 0 ? findings : [{ kind: 'ok' }];
}

export function describeWarningFinding(finding: WarningFinding): string {
  switch (finding.kind) {
    case 'ok':
      return 'The warning statement is present and matches the required text exactly.';
    case 'missing':
      return 'No government warning statement was found on the label.';
    case 'prefix_missing':
      return 'The warning does not begin with "GOVERNMENT WARNING:".';
    case 'prefix_not_exact':
      return `The lead-in is printed as "${finding.prefixAsPrinted}". It must read "GOVERNMENT WARNING:" in capital letters.`;
    case 'wording_differs':
      return 'The warning wording differs from the required text.';
  }
}

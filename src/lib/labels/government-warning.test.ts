import { describe, expect, it } from 'vitest';
import { GOVERNMENT_WARNING_CANONICAL as CANONICAL } from './ttb-constants';
import { analyzeGovernmentWarning } from './government-warning';

const kinds = (text: string | null) => analyzeGovernmentWarning(text).map((f) => f.kind);

describe('analyzeGovernmentWarning', () => {
  it('accepts the exact statement', () => {
    expect(kinds(CANONICAL)).toEqual(['ok']);
  });

  it('accepts the exact statement wrapped across lines', () => {
    expect(kinds(CANONICAL.replace(/ /g, '\n').replace('(2)', '\n\n(2)'))).toEqual(['ok']);
  });

  // Jenny Park: "they used 'Government Warning' in title case instead of all
  // caps. Rejected." The previous rule case-folded the text and let this pass.
  it('rejects a title-case lead-in', () => {
    const findings = analyzeGovernmentWarning(
      CANONICAL.replace('GOVERNMENT WARNING:', 'Government Warning:'),
    );
    expect(findings).toEqual([{ kind: 'prefix_not_exact', prefixAsPrinted: 'Government Warning:' }]);
  });

  it('rejects a lead-in without its colon', () => {
    expect(kinds(CANONICAL.replace('WARNING:', 'WARNING'))).toEqual(['prefix_not_exact']);
  });

  // The previous extractor substituted the canonical text when the lead-in
  // was missing, so this could never fail.
  it('rejects a statement with no lead-in', () => {
    expect(kinds(CANONICAL.replace('GOVERNMENT WARNING: ', ''))).toEqual(['prefix_missing']);
  });

  it('rejects reworded text', () => {
    expect(kinds(CANONICAL.replace('women should not drink', 'pregnant women should avoid'))).toEqual([
      'wording_differs',
    ]);
  });

  it('rejects changed capitalization in the body', () => {
    expect(kinds(CANONICAL.replace('Surgeon General', 'surgeon general'))).toEqual(['wording_differs']);
  });

  it('reports every problem at once', () => {
    expect(kinds(CANONICAL.toLowerCase())).toEqual(['prefix_not_exact', 'wording_differs']);
  });

  it('reports a missing statement', () => {
    expect(kinds(null)).toEqual(['missing']);
    expect(kinds('   ')).toEqual(['missing']);
  });
});

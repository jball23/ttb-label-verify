import { analyzeGovernmentWarning, describeWarningFinding } from '../government-warning';
import { type LabelRule } from './types';

export const governmentWarningRule: LabelRule = {
  id: 'governmentWarning',
  label: 'Government warning',
  cfr: {
    section: '27 CFR §16.21–16.22',
    summary:
      'Every container must carry the health warning word for word, with "GOVERNMENT WARNING" in capital letters and bold type.',
  },
  check(reading) {
    const { verbatimText, prefixAppearsBold } = reading.governmentWarning;
    const findings = analyzeGovernmentWarning(verbatimText);
    const problems = findings.filter((f) => f.kind !== 'ok');

    if (problems.length > 0) {
      return {
        status: 'fail',
        reason: problems.map(describeWarningFinding).join(' '),
        value: verbatimText,
      };
    }
    // Text is exact. Boldness is a visual judgment, so it never auto-fails.
    if (prefixAppearsBold === false) {
      return {
        status: 'review',
        reason: 'The wording is exact, but "GOVERNMENT WARNING:" may not be in bold type.',
        value: verbatimText,
      };
    }
    if (prefixAppearsBold === null) {
      return {
        status: 'review',
        reason: 'The wording is exact. Check that "GOVERNMENT WARNING:" is in bold type.',
        value: verbatimText,
      };
    }
    return { status: 'pass', reason: describeWarningFinding({ kind: 'ok' }), value: verbatimText };
  },
};

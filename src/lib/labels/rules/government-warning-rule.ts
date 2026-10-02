import { analyzeGovernmentWarning, describeWarningFinding } from '../government-warning';
import { type LabelRule } from './types';

export const governmentWarningRule: LabelRule = {
  id: 'governmentWarning',
  label: 'Government warning',
  check(reading) {
    const { verbatimText } = reading.governmentWarning;
    const findings = analyzeGovernmentWarning(verbatimText);
    const problems = findings.filter((f) => f.kind !== 'ok');

    if (problems.length > 0) {
      return {
        status: 'fail',
        reason: problems.map(describeWarningFinding).join(' '),
        value: verbatimText,
      };
    }
    // Bold type is left to the reviewer: the model's judgment of type weight
    // was wrong too often (bold lead-ins on Russkaya and Tenuta read as plain).
    return {
      status: 'pass',
      reason: describeWarningFinding({ kind: 'ok' }),
      value: verbatimText,
      reminder: 'Check on the photo that "GOVERNMENT WARNING:" is in bold type.',
    };
  },
};

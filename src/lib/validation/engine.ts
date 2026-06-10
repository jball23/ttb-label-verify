import { type ExtractedFields } from '../extraction/types';
import { type Rule, type VerificationReport } from './types';
import brandRule from './rules/brand';
import abvRule from './rules/abv';
import governmentWarningRule from './rules/government-warning';
import netContentsRule from './rules/net-contents';
import classTypeRule from './rules/class-type';
import producerOriginRule from './rules/producer-origin';

/**
 * The full TTB rule set in display order.
 *
 * Adding a rule = adding a module + appending to this list. No engine edits.
 * Open/Closed in practice.
 */
export const RULES: readonly Rule[] = [
  brandRule,
  abvRule,
  governmentWarningRule,
  netContentsRule,
  classTypeRule,
  producerOriginRule,
];

export function runRules(extracted: ExtractedFields): VerificationReport {
  const fields: Record<string, ReturnType<Rule['check']>> = {};
  let anyFail = false;
  for (const rule of RULES) {
    const result = rule.check(extracted);
    fields[rule.id] = result;
    if (result.status === 'fail') {
      anyFail = true;
    }
  }
  return {
    overallStatus: anyFail ? 'needs_review' : 'compliant',
    fields,
  };
}

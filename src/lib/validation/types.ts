import { type ExtractedFields } from '../extraction/types';

export type FieldStatus = 'pass' | 'fail' | 'uncertain';

export interface RuleResult {
  status: FieldStatus;
  reason?: string;
  extractedValue?: string | null;
}

export interface Rule {
  id: string;
  label: string;
  check(extracted: ExtractedFields): RuleResult;
}

export type OverallStatus = 'compliant' | 'needs_review';

export interface VerificationReport {
  overallStatus: OverallStatus;
  fields: Record<string, RuleResult>;
}

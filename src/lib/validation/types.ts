import {
  type ExtractedApplicationForm,
  type ExtractedFields,
  type ProvenanceMap,
} from '../extraction/types';
import { type CrossCheckReport } from '../cross-check/types';

// 'warn' is a soft failure that draws the reviewer's eye but does NOT route
// to non_compliant — used for non-GW rule failures (format quirks, missing
// brand, country phrasing, etc.). Only Government Warning emits 'fail', the
// one rule whose failure auto-routes to the Rejected bucket.
export type FieldStatus = 'pass' | 'warn' | 'fail' | 'uncertain';

export interface RuleResult {
  status: FieldStatus;
  reason?: string;
  extractedValue?: string | null;
}

export interface CfrCitation {
  /** Section reference, e.g. "27 CFR §16.21" */
  section: string;
  /** Plain-language summary of what this rule enforces. */
  summary: string;
  /** A short verbatim quote of the operative regulatory text. */
  quote: string;
}

export interface Rule {
  id: string;
  label: string;
  cfr: CfrCitation;
  check(extracted: ExtractedFields): RuleResult;
}

export type OverallStatus = 'compliant' | 'needs_review' | 'non_compliant';

export interface VerificationReport {
  overallStatus: OverallStatus;
  crossCheck: CrossCheckReport;
  fields: Record<string, RuleResult>;
  provenance: ProvenanceMap;
  /**
   * The bare extracted application form. Surfaces every form field the model
   * read so the UI can list them all (not just the cross-check subset).
   */
  extractedForm: ExtractedApplicationForm;
  /** Bare label-side extraction. Used by the UI to display every label field. */
  extractedLabel: ExtractedFields;
}

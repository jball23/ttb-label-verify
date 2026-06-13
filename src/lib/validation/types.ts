import {
  type ExtractedApplicationForm,
  type ExtractedFields,
  type FieldBboxes,
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
  /**
   * Optional for backwards compatibility with older rows/results that were
   * produced before synchronous form parsing populated the comparison block.
   */
  crossCheck?: CrossCheckReport;
  fields: Record<string, RuleResult>;
  /**
   * Legacy normalized 0-1 bboxes from the full-document OpenAI path.
   * Usually empty `{}` under the default Tesseract pipeline.
   */
  provenance: ProvenanceMap;
  /**
   * Per-field pixel-space source rectangles from PDF text, Tesseract OCR,
   * or text-only VLM fallback markers.
   */
  bboxes?: FieldBboxes;
  /**
   * The bare extracted application form. The UI only surfaces fields that
   * drive label review, but the fuller shape is kept for rules and exports.
   */
  extractedForm: ExtractedApplicationForm;
  /** Bare label-side extraction. Used by the UI to display every label field. */
  extractedLabel: ExtractedFields;
  /**
   * Page-render metadata from `renderApplicationPages`. The classifier-emitted
   * `kind` tells the detail view which PDF pages are the form, front-label,
   * back-label, etc. — used by the source-viewer tab strip so a `Front` tab
   * stays enabled even when no Tesseract bbox happened to land on that page
   * (common when the front-label artwork is decorative wordmarks that OCR
   * rejects below the confidence floor).
   */
  pages?: Array<{ pageNumber: number; kind: string }>;
}

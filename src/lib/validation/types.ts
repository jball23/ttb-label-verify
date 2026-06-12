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
   * Optional under the Phase A split. The sync verify path returns the
   * report without cross-check; Phase B's patch endpoint adds it once the
   * form-side OCR finishes.
   */
  crossCheck?: CrossCheckReport;
  fields: Record<string, RuleResult>;
  /**
   * Legacy normalized 0-1 bboxes from the GPT-4o provenance code path.
   * Always empty `{}` under the Tesseract pipeline. Detail view uses
   * `bboxes` instead — see KD9 for the loader's shape-detection logic.
   */
  provenance: ProvenanceMap;
  /**
   * U4 / KD2: per-field pixel-space WordRect lists. Optional during
   * the U4 cascade — archived rows without this key fall back to
   * read-only rendering (KD9).
   */
  bboxes?: FieldBboxes;
  /**
   * The bare extracted application form. Surfaces every form field the model
   * read so the UI can list them all (not just the cross-check subset).
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

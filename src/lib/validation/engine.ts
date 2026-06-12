import {
  type ExtractedApplicationForm,
  type ExtractedFields,
  type ProvenanceMap,
} from '../extraction/types';
import { type Application } from '../application/types';
import { runCrossCheck } from '../cross-check/engine';
import {
  type CrossCheckReport,
  CROSS_CHECK_FIELDS,
  CROSS_CHECK_FIELD_LABELS,
} from '../cross-check/types';
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

/**
 * Run the label-only rule set against the extracted fields. Internal helper
 * used by both `runRules` (legacy) and `runVerification` (cross-check-aware).
 */
function runRulesInternal(extracted: ExtractedFields): {
  fields: Record<string, ReturnType<Rule['check']>>;
  anyFailOrWarn: boolean;
} {
  const fields: Record<string, ReturnType<Rule['check']>> = {};
  let anyFailOrWarn = false;
  for (const rule of RULES) {
    const result = rule.check(extracted);
    fields[rule.id] = result;
    if (result.status === 'fail' || result.status === 'warn') {
      anyFailOrWarn = true;
    }
  }
  return { fields, anyFailOrWarn };
}

/**
 * Full verification: cross-check (application vs label) + label-only rules.
 *
 * Verdict tiers (matching how TTB actually decides):
 *   - non_compliant: a critical compliance failure that auto-routes to the
 *     Rejected bucket. Only Government Warning failure qualifies — it is
 *     the one rule that emits status: 'fail'.
 *   - needs_review: any non-GW rule emitted 'warn' (format quirks, missing
 *     brand, country phrasing, net-contents unit, etc.) OR the cross-check
 *     surfaced any difference between the application and the label. The
 *     reviewer should glance, but the default disposition is approve.
 *   - compliant: every rule passed and the cross-check is clean.
 *
 * Cross-check differences and non-GW rule warnings NEVER push the verdict
 * past needs_review — those rows land in the Approved bucket awaiting the
 * reviewer's final call on Finalize.
 *
 * `uncertain` rules do NOT trip the verdict (preserves existing behavior).
 */
export function runVerification(
  application: Application,
  extracted: ExtractedFields,
  provenance: ProvenanceMap = {},
  extractedForm?: ExtractedApplicationForm,
  bboxes?: import('../extraction/types').FieldBboxes,
): VerificationReport {
  const crossCheck: CrossCheckReport = runCrossCheck(application, extracted);
  const { fields, anyFailOrWarn } = runRulesInternal(extracted);

  const govWarningFailed = fields['governmentWarning']?.status === 'fail';

  let overallStatus: VerificationReport['overallStatus'];
  if (govWarningFailed) {
    overallStatus = 'non_compliant';
  } else if (crossCheck.overallStatus === 'mismatch' || anyFailOrWarn) {
    overallStatus = 'needs_review';
  } else {
    overallStatus = 'compliant';
  }

  return {
    overallStatus,
    crossCheck,
    fields,
    provenance,
    bboxes,
    extractedForm: extractedForm ?? extractedFormFromApplication(application),
    extractedLabel: extracted,
  };
}

function extractedFormFromApplication(application: Application): ExtractedApplicationForm {
  // Fallback for callers that don't pass the raw extraction — derive a
  // sufficient ExtractedApplicationForm from the synthesized Application so
  // the UI never has to render an empty form panel.
  const f = application.form;
  return {
    repId: f.repId,
    plantRegistryNumber: f.plantRegistryNumber,
    source: f.source,
    serialNumber: f.serialNumber,
    productType: f.productType,
    brandName: f.brandName,
    fancifulName: f.fancifulName,
    applicant: {
      name: f.applicant.name,
      addressLine1: f.applicant.addressLine1,
      city: f.applicant.city,
      state: f.applicant.state,
      postalCode: f.applicant.postalCode,
    },
    // Application.form's mailingAddress is a structured ApplicantSchema; the
    // extracted form's mailingAddress is a flat free-form string. Join the
    // relevant lines when present, null otherwise.
    mailingAddress: f.mailingAddress
      ? [
          f.mailingAddress.name,
          f.mailingAddress.addressLine1,
          f.mailingAddress.city,
          f.mailingAddress.state,
          f.mailingAddress.postalCode,
        ]
          .filter((s): s is string => Boolean(s))
          .join(', ') || null
      : null,
    formula: f.formulaId,
    grapeVarietals: f.grapeVarietals,
    wineAppellation: f.wineAppellation,
    phone: f.phone || null,
    email: f.email || null,
    applicationType: f.applicationType,
    // containerInfo on the canonical Application is an `unknown` slot —
    // there's no string representation of it here, so we surface it as
    // null. Real extraction sets containerWording directly.
    containerWording: null,
    applicationDate: f.applicationDate,
    applicantSignatureName: f.applicantSignatureName,
  };
}

/**
 * Backwards-compatible wrapper for callers that only have ExtractedFields (no
 * Application). Wraps `runRulesInternal` with an empty cross-check so the
 * VerificationReport shape stays consistent. Used by legacy evaluators and
 * existing engine tests that pre-date the cross-check pivot.
 */
export function runRules(extracted: ExtractedFields): VerificationReport {
  const { fields, anyFailOrWarn } = runRulesInternal(extracted);
  const govWarningFailed = fields['governmentWarning']?.status === 'fail';
  const overallStatus: VerificationReport['overallStatus'] = govWarningFailed
    ? 'non_compliant'
    : anyFailOrWarn
      ? 'needs_review'
      : 'compliant';
  return {
    overallStatus,
    crossCheck: emptyCrossCheckReport(),
    fields,
    provenance: {},
    extractedForm: blankExtractedForm(),
    extractedLabel: extracted,
  };
}

function blankExtractedForm(): ExtractedApplicationForm {
  return {
    repId: null,
    plantRegistryNumber: null,
    source: null,
    serialNumber: null,
    productType: null,
    brandName: null,
    fancifulName: null,
    applicant: {
      name: null,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    },
    mailingAddress: null,
    formula: null,
    grapeVarietals: null,
    wineAppellation: null,
    phone: null,
    email: null,
    applicationType: null,
    containerWording: null,
    applicationDate: null,
    applicantSignatureName: null,
  };
}

function emptyCrossCheckReport(): CrossCheckReport {
  const fields = {} as CrossCheckReport['fields'];
  for (const id of CROSS_CHECK_FIELDS) {
    fields[id] = {
      id,
      label: CROSS_CHECK_FIELD_LABELS[id],
      status: 'not_applicable',
      applicationValue: null,
      labelValue: null,
    };
  }
  return { overallStatus: 'match', fields };
}

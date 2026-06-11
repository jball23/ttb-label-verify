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
  anyFail: boolean;
} {
  const fields: Record<string, ReturnType<Rule['check']>> = {};
  let anyFail = false;
  for (const rule of RULES) {
    const result = rule.check(extracted);
    fields[rule.id] = result;
    if (result.status === 'fail') {
      anyFail = true;
    }
  }
  return { fields, anyFail };
}

/**
 * Full verification: cross-check (application vs label) + label-only rules.
 *
 * Verdict tiers (matching how TTB actually decides):
 *   - non_compliant: a critical compliance failure that a human reviewer
 *     would also fail. Currently means the Government Warning rule failed —
 *     the highest-stakes label requirement under 27 CFR §16.21. Per Jenny
 *     Park: "It has to be exact. Like, word-for-word..." Everything else
 *     requires judgment a human reviewer is expected to apply.
 *   - needs_review: any other rule failed (ABV format, brand presence,
 *     net contents, class-type, producer/origin) OR the cross-check
 *     surfaced any difference between the application and the label. The
 *     reviewer should glance, but the default disposition is approve.
 *   - compliant: every rule passed and the cross-check is clean.
 *
 * Cross-check differences (brand-name drift, producer mismatch, country
 * phrasing, etc.) NEVER push the verdict past needs_review — TTB approves
 * plenty of labels with surface drift on either side (see the stakeholder
 * interviews on judgment calls like "STONE'S THROW" vs "Stone's Throw" or
 * importer-vs-producer).
 *
 * `uncertain` rules do NOT trip the verdict (preserves existing behavior).
 */
export function runVerification(
  application: Application,
  extracted: ExtractedFields,
  provenance: ProvenanceMap = {},
  extractedForm?: ExtractedApplicationForm,
): VerificationReport {
  const crossCheck: CrossCheckReport = runCrossCheck(application, extracted);
  const { fields, anyFail } = runRulesInternal(extracted);

  const govWarningFailed = fields['governmentWarning']?.status === 'fail';

  let overallStatus: VerificationReport['overallStatus'];
  if (govWarningFailed) {
    overallStatus = 'non_compliant';
  } else if (crossCheck.overallStatus === 'mismatch' || anyFail) {
    overallStatus = 'needs_review';
  } else {
    overallStatus = 'compliant';
  }

  return {
    overallStatus,
    crossCheck,
    fields,
    provenance,
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
    grapeVarietals: f.grapeVarietals,
    wineAppellation: f.wineAppellation,
    phone: f.phone || null,
    email: f.email || null,
    applicationType: f.applicationType,
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
  const { fields, anyFail } = runRulesInternal(extracted);
  const govWarningFailed = fields['governmentWarning']?.status === 'fail';
  const overallStatus: VerificationReport['overallStatus'] = govWarningFailed
    ? 'non_compliant'
    : anyFail
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
    grapeVarietals: null,
    wineAppellation: null,
    phone: null,
    email: null,
    applicationType: null,
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

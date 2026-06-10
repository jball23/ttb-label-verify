import type { ExtractedFields } from '../extraction/types';
import type { Application } from '../application/types';
import {
  CROSS_CHECK_FIELDS,
  CROSS_CHECK_FIELD_LABELS,
  type CrossCheckFieldId,
  type CrossCheckFieldResult,
  type CrossCheckReport,
} from './types';
import {
  normalizedExact,
  producerMatches,
  countryMatches,
  classTypeMatches,
} from './normalize';

/**
 * Compare a COLA application's declared field values against the label
 * extractor's output, field by field. Produces a deterministic report —
 * no LLM in this path.
 *
 * Field rules:
 * - brandName / wineVarietal / wineAppellation: normalized exact
 * - classType: normalized exact OR alias OR token containment (handles
 *   IPA ⇄ India Pale Ale, Bourbon Whiskey ⇄ Kentucky Straight Bourbon Whiskey)
 * - producer: token-set Jaccard (handles "Distilled and Bottled by" prefixes
 *   and city/state drift between Kentucky ⇄ KY etc.)
 * - countryOfOrigin: normalized exact with USA aliases
 *
 * Wine-only fields are reported as `not_applicable` when the application's
 * productType is not "WINE", so non-wine scenarios produce a clean overall
 * status without dragging wine fields into the verdict.
 */
export function runCrossCheck(
  application: Application,
  extracted: ExtractedFields,
): CrossCheckReport {
  const fields: Record<CrossCheckFieldId, CrossCheckFieldResult> = {} as Record<
    CrossCheckFieldId,
    CrossCheckFieldResult
  >;
  let anyMismatchOrMissing = false;

  for (const id of CROSS_CHECK_FIELDS) {
    const result = checkField(id, application, extracted);
    fields[id] = result;
    if (result.status === 'mismatch' || result.status === 'not_on_label') {
      anyMismatchOrMissing = true;
    }
  }

  return {
    overallStatus: anyMismatchOrMissing ? 'mismatch' : 'match',
    fields,
  };
}

function checkField(
  id: CrossCheckFieldId,
  application: Application,
  extracted: ExtractedFields,
): CrossCheckFieldResult {
  const label = CROSS_CHECK_FIELD_LABELS[id];

  // Wine-only fields: report as not_applicable for non-wine applications.
  if (id === 'wineVarietal' || id === 'wineAppellation') {
    if (application.form.productType !== 'WINE') {
      return {
        id,
        label,
        status: 'not_applicable',
        applicationValue: null,
        labelValue: null,
        reason: 'Not a wine label — wine-specific field skipped.',
      };
    }
  }

  const applicationValue = readApplicationValue(id, application);
  const labelValue = readLabelValue(id, extracted);

  // Application doesn't declare an expectation for this field.
  if (applicationValue == null) {
    return {
      id,
      label,
      status: 'not_applicable',
      applicationValue: null,
      labelValue,
      reason: 'No expectation declared on the application.',
    };
  }

  // Application expects a value but the label doesn't have one.
  if (labelValue == null || labelValue.trim() === '') {
    return {
      id,
      label,
      status: 'not_on_label',
      applicationValue,
      labelValue,
      reason: `Application declares ${label.toLowerCase()} but the label is missing this field.`,
    };
  }

  const matched = compareField(id, applicationValue, labelValue);
  return {
    id,
    label,
    status: matched ? 'match' : 'mismatch',
    applicationValue,
    labelValue,
    reason: matched
      ? undefined
      : `Application declares "${applicationValue}" but label shows "${labelValue}".`,
  };
}

function readApplicationValue(
  id: CrossCheckFieldId,
  application: Application,
): string | null {
  const ex = application.crossCheckExpectations;
  switch (id) {
    case 'brandName':
      return ex.brandName;
    case 'classType':
      return ex.classType;
    case 'producer':
      return ex.producer;
    case 'countryOfOrigin':
      return ex.countryOfOrigin;
    case 'wineVarietal':
      return ex.wineVarietal ?? null;
    case 'wineAppellation':
      return ex.wineAppellation ?? null;
  }
}

function readLabelValue(
  id: CrossCheckFieldId,
  extracted: ExtractedFields,
): string | null {
  switch (id) {
    case 'brandName':
      return extracted.brandName;
    case 'classType':
      return extracted.classType;
    case 'producer':
      return extracted.producer;
    case 'countryOfOrigin':
      return extracted.countryOfOrigin;
    case 'wineVarietal':
      return extracted.wineVarietal;
    case 'wineAppellation':
      return extracted.wineAppellation;
  }
}

function compareField(
  id: CrossCheckFieldId,
  applicationValue: string,
  labelValue: string,
): boolean {
  switch (id) {
    case 'brandName':
    case 'wineVarietal':
    case 'wineAppellation':
      return normalizedExact(applicationValue) === normalizedExact(labelValue);
    case 'producer':
      return producerMatches(applicationValue, labelValue);
    case 'countryOfOrigin':
      return countryMatches(applicationValue, labelValue);
    case 'classType':
      return classTypeMatches(applicationValue, labelValue);
  }
}

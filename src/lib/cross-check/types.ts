/**
 * Cross-check result contract.
 *
 * The cross-check engine compares the COLA application's declared field values
 * against what the label extractor pulled from the label image, producing one
 * `CrossCheckFieldResult` per regulated field. `runVerification` composes this
 * with the existing six TTB label-only rules into a single `VerificationReport`.
 */

export const CROSS_CHECK_FIELDS = [
  'brandName',
  'classType',
  'producer',
  'countryOfOrigin',
  'wineVarietal',
  'wineAppellation',
] as const;

export type CrossCheckFieldId = (typeof CROSS_CHECK_FIELDS)[number];

export type CrossCheckStatus =
  | 'match'
  | 'mismatch'
  | 'not_on_label'
  | 'not_applicable';

export interface CrossCheckFieldResult {
  id: CrossCheckFieldId;
  label: string;
  status: CrossCheckStatus;
  applicationValue: string | null;
  labelValue: string | null;
  reason?: string;
}

export type CrossCheckOverallStatus = 'match' | 'mismatch';

export interface CrossCheckReport {
  overallStatus: CrossCheckOverallStatus;
  fields: Record<CrossCheckFieldId, CrossCheckFieldResult>;
}

export const CROSS_CHECK_FIELD_LABELS: Record<CrossCheckFieldId, string> = {
  brandName: 'Brand name',
  classType: 'Class / type designation (Item 7)',
  producer: 'Producer',
  countryOfOrigin: 'Country of origin',
  wineVarietal: 'Grape varietal',
  wineAppellation: 'Wine appellation',
};

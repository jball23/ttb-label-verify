import { type ResultLine } from '../results/result-types';

const COLUMNS = [
  'filename',
  'status',
  'overallStatus',
  'brandStatus',
  'brandValue',
  'abvStatus',
  'abvValue',
  'governmentWarningStatus',
  'governmentWarningReason',
  'netContentsStatus',
  'netContentsValue',
  'classTypeStatus',
  'classTypeValue',
  'producerOriginStatus',
  'producerOriginValue',
  'errorMessage',
  'durationMs',
] as const;

type Column = (typeof COLUMNS)[number];

/**
 * RFC 4180 field escaping: wrap in quotes if the value contains a comma,
 * quote, or newline; double quotes inside fields.
 */
function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowForResult(result: ResultLine): Record<Column, string | number | null> {
  if (result.status === 'error') {
    return {
      filename: result.filename,
      status: 'error',
      overallStatus: null,
      brandStatus: null,
      brandValue: null,
      abvStatus: null,
      abvValue: null,
      governmentWarningStatus: null,
      governmentWarningReason: null,
      netContentsStatus: null,
      netContentsValue: null,
      classTypeStatus: null,
      classTypeValue: null,
      producerOriginStatus: null,
      producerOriginValue: null,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
    };
  }
  const f = result.report.fields;
  return {
    filename: result.filename,
    status: 'ok',
    overallStatus: result.report.overallStatus,
    brandStatus: f.brand?.status ?? null,
    brandValue: f.brand?.extractedValue ?? null,
    abvStatus: f.abv?.status ?? null,
    abvValue: f.abv?.extractedValue ?? null,
    governmentWarningStatus: f.governmentWarning?.status ?? null,
    governmentWarningReason: f.governmentWarning?.reason ?? null,
    netContentsStatus: f.netContents?.status ?? null,
    netContentsValue: f.netContents?.extractedValue ?? null,
    classTypeStatus: f.classType?.status ?? null,
    classTypeValue: f.classType?.extractedValue ?? null,
    producerOriginStatus: f.producerOrigin?.status ?? null,
    producerOriginValue: f.producerOrigin?.extractedValue ?? null,
    errorMessage: null,
    durationMs: result.durationMs,
  };
}

export function formatCSV(results: ResultLine[]): string {
  const header = COLUMNS.join(',');
  const rows = results.map((r) => {
    const row = rowForResult(r);
    return COLUMNS.map((c) => escapeField(row[c])).join(',');
  });
  return [header, ...rows].join('\r\n') + '\r\n';
}

export const CSV_COLUMNS = COLUMNS;

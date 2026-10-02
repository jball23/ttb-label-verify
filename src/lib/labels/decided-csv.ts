import { LABEL_FIELD_IDS, LABEL_FIELD_LABELS } from './reading';
import { type LabelView } from './label-view';
import { VERDICT_LABELS } from './verdict';

/** One row per decided label: the decision, the tool's suggestion and every field as judged. */
export function decidedLabelsCsv(labels: readonly LabelView[]): string {
  const header = [
    'File',
    'Decision',
    'Reason',
    'Reviewer',
    'Decided at',
    'Tool suggestion',
    ...LABEL_FIELD_IDS.map((field) => LABEL_FIELD_LABELS[field]),
    'Government warning',
    'Corrected fields',
  ];
  const rows = labels.map((view) => {
    const latest = view.decisions[0];
    const { effectiveReading, corrections } = view.report;
    return [
      view.filename,
      view.status,
      latest?.reason ?? '',
      latest?.reviewer ?? '',
      view.statusAt,
      VERDICT_LABELS[view.report.verdict],
      ...LABEL_FIELD_IDS.map((field) => effectiveReading.fields[field].value ?? ''),
      effectiveReading.governmentWarning.verbatimText ?? '',
      Object.keys(corrections).join('; '),
    ];
  });
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

/** RFC 4180: quote fields containing a comma, quote or line break; double inner quotes. */
export function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ComparisonStatus } from '@/lib/labels/compare-expected';
import { isConfirmation, originalValue, type CorrectableField, type CorrectionValues } from '@/lib/labels/corrections';
import { LABEL_FIELD_IDS, LABEL_FIELD_LABELS, type ExpectedValues, type LabelFieldId } from '@/lib/labels/reading';
import { type LabelReport } from '@/lib/labels/verify-label';
import { cn } from '@/lib/utils';
import { highlightHandlers, type OnHighlight } from './highlight';

interface Props {
  report: LabelReport;
  saving: boolean;
  onHighlight: OnHighlight;
  onSave(values: { expected: ExpectedValues; corrections: CorrectionValues }): void;
}

const COMPARISON_TEXT: Record<ComparisonStatus, { text: string; className: string } | null> = {
  match: { text: 'Matches', className: 'text-status-good' },
  differs: { text: 'Differs', className: 'text-status-review' },
  not_found_on_label: { text: 'Not on label', className: 'text-status-review' },
  not_entered: null,
};

/**
 * Two separate jobs, kept visibly apart: fixing what the label says (a
 * tracked correction of the AI reading) and entering what the application
 * says (to compare against).
 */
export function ReviewerValuesForm({ report, saving, onHighlight, onSave }: Props) {
  const initialCorrections = useMemo(() => correctionDrafts(report), [report]);
  const [corrections, setCorrections] = useState<CorrectionValues>(initialCorrections);
  const [expected, setExpected] = useState<ExpectedValues>(report.expected);
  const [editing, setEditing] = useState<Set<CorrectableField>>(new Set());

  const dirty =
    JSON.stringify(cleanExpected(expected)) !== JSON.stringify(cleanExpected(report.expected)) ||
    JSON.stringify(corrections) !== JSON.stringify(initialCorrections);

  function submit(event: FormEvent) {
    event.preventDefault();
    setEditing(new Set());
    onSave({ expected: cleanExpected(expected), corrections });
  }

  function startEditing(field: CorrectableField) {
    setEditing((current) => new Set(current).add(field));
    setCorrections((current) => (field in current ? current : { ...current, [field]: originalValue(report.reading, field) }));
  }

  function undoCorrection(field: CorrectableField) {
    setEditing((current) => {
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setCorrections(({ [field]: _removed, ...rest }) => rest);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[34rem] border-collapse text-left text-base">
          <thead className="bg-muted/60 text-sm text-muted-foreground">
            <tr>
              <th scope="col" className="w-40 px-4 py-3 font-semibold">Field</th>
              <th scope="col" className="px-4 py-3 font-semibold">On the label</th>
              <th scope="col" className="w-64 px-4 py-3 font-semibold">In the application (optional)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {LABEL_FIELD_IDS.map((field) => (
              <FieldRow
                key={field}
                field={field}
                report={report}
                onHighlight={onHighlight}
                editing={editing.has(field)}
                correction={corrections[field]}
                onCorrect={(value) => setCorrections((current) => ({ ...current, [field]: value }))}
                onEdit={() => startEditing(field)}
                onUndo={() => undoCorrection(field)}
                expected={expected[field] ?? ''}
                onExpected={(value) => setExpected((current) => ({ ...current, [field]: value }))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <WarningCorrection
        report={report}
        onHighlight={onHighlight}
        editing={editing.has('governmentWarning')}
        value={corrections.governmentWarning}
        onChange={(value) => setCorrections((current) => ({ ...current, governmentWarning: value }))}
        onEdit={() => startEditing('governmentWarning')}
        onUndo={() => undoCorrection('governmentWarning')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" className="text-base" disabled={!dirty || saving}>
          {saving ? 'Checking…' : 'Save and check again'}
        </Button>
        <span className="text-base text-muted-foreground">
          {dirty ? 'You have unsaved changes.' : 'Fix a reading or enter application values, then check again.'}
        </span>
      </div>
    </form>
  );
}

interface FieldRowProps {
  field: LabelFieldId;
  report: LabelReport;
  onHighlight: OnHighlight;
  editing: boolean;
  correction: string | null | undefined;
  onCorrect(value: string | null): void;
  onEdit(): void;
  onUndo(): void;
  expected: string;
  onExpected(value: string): void;
}

function FieldRow({ field, report, onHighlight, editing, correction, onCorrect, onEdit, onUndo, expected, onExpected }: FieldRowProps) {
  const correctionId = useId();
  const expectedId = useId();
  const label = LABEL_FIELD_LABELS[field];
  const read = report.reading.fields[field];
  const saved = report.corrections[field];
  const comparison = report.comparisons.find((c) => c.field === field);
  const result = comparison ? COMPARISON_TEXT[comparison.status] : null;
  const corrected = correction !== undefined;

  return (
    <tr {...highlightHandlers(field, onHighlight)} className="align-top hover:bg-sky-500/5 focus-within:bg-sky-500/5">
      <th scope="row" className="px-4 py-3 font-semibold">{label}</th>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={correctionId} className="text-sm text-muted-foreground">
              What the label actually says (leave empty if it is not on the label)
            </label>
            <Input
              id={correctionId}
              value={correction ?? ''}
              onChange={(event) => onCorrect(event.target.value || null)}
              className="h-11 text-base"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(!(corrected ? correction : read.value) && 'text-muted-foreground')}>
                {(corrected ? correction : read.value) ?? 'Not found on the label'}
              </span>
              {!corrected && read.value && read.confidence === 'low' ? (
                <span className="rounded bg-warning/25 px-1.5 py-0.5 text-xs font-semibold text-status-review">Hard to read</span>
              ) : null}
            </div>
            {corrected ? <CorrectionNote report={report} field={field} saved={saved} /> : null}
          </div>
        )}
        <CorrectionActions editing={editing} corrected={corrected} onEdit={onEdit} onUndo={onUndo} />
      </td>
      <td className="px-4 py-3">
        <label htmlFor={expectedId} className="sr-only">
          {label} in the application
        </label>
        <Input id={expectedId} value={expected} onChange={(event) => onExpected(event.target.value)} className="h-11 text-base" />
        {result ? <p className={cn('mt-1 text-sm font-semibold', result.className)}>{result.text}</p> : null}
      </td>
    </tr>
  );
}

interface WarningCorrectionProps {
  report: LabelReport;
  onHighlight: OnHighlight;
  editing: boolean;
  value: string | null | undefined;
  onChange(value: string | null): void;
  onEdit(): void;
  onUndo(): void;
}

function WarningCorrection({ report, onHighlight, editing, value, onChange, onEdit, onUndo }: WarningCorrectionProps) {
  const id = useId();
  const corrected = value !== undefined;
  const saved = report.corrections.governmentWarning;
  const shown = corrected ? value : report.reading.governmentWarning.verbatimText;
  return (
    <section
      {...highlightHandlers('governmentWarning', onHighlight)}
      className="flex flex-col gap-2 rounded-xl border border-border p-4 hover:bg-sky-500/5 focus-within:bg-sky-500/5"
    >
      <h3 className="text-base font-semibold">Government warning, as printed</h3>
      {editing ? (
        <>
          <label htmlFor={id} className="text-sm text-muted-foreground">
            Type the warning exactly as it appears, including capital letters.
          </label>
          <textarea
            id={id}
            rows={4}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value || null)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </>
      ) : (
        <p className={cn('font-mono text-sm leading-relaxed', !shown && 'text-muted-foreground')}>
          {shown ?? 'No warning was found on the label.'}
        </p>
      )}
      {corrected && !editing ? <CorrectionNote report={report} field="governmentWarning" saved={saved} /> : null}
      <CorrectionActions editing={editing} corrected={corrected} onEdit={onEdit} onUndo={onUndo} />
    </section>
  );
}

/** "Read as X · corrected by JP", "Confirmed by JP", or a not-yet-saved note. */
function CorrectionNote({ report, field, saved }: { report: LabelReport; field: CorrectableField; saved: LabelReport['corrections'][CorrectableField] }) {
  if (!saved) return <span className="text-sm text-muted-foreground">Not saved yet.</span>;
  const by = saved.reviewer ? ` by ${saved.reviewer}` : '';
  if (isConfirmation(report.reading, field, saved)) {
    return <span className="text-sm text-muted-foreground">Confirmed{by}.</span>;
  }
  const original = originalValue(report.reading, field);
  const shown = original && original.length > 60 ? `${original.slice(0, 60)}…` : original;
  return (
    <span className="text-sm text-muted-foreground">
      Read as “{shown ?? 'nothing'}” · corrected{by}. The original reading is kept.
    </span>
  );
}

const LINK_BUTTON = 'inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:no-underline';

function CorrectionActions({ editing, corrected, onEdit, onUndo }: { editing: boolean; corrected: boolean; onEdit(): void; onUndo(): void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {!editing ? (
        <button type="button" onClick={onEdit} className={LINK_BUTTON}>
          <Pencil aria-hidden className="size-3.5" /> Fix this reading
        </button>
      ) : null}
      {corrected ? (
        <button type="button" onClick={onUndo} className={LINK_BUTTON}>
          <RotateCcw aria-hidden className="size-3.5" /> Use the original reading
        </button>
      ) : null}
    </div>
  );
}

function correctionDrafts(report: LabelReport): CorrectionValues {
  return Object.fromEntries(
    Object.entries(report.corrections).map(([field, correction]) => [field, correction?.value ?? null]),
  );
}

function cleanExpected(expected: ExpectedValues): ExpectedValues {
  return Object.fromEntries(
    Object.entries(expected).flatMap(([field, value]) => (value?.trim() ? [[field, value.trim()]] : [])),
  );
}

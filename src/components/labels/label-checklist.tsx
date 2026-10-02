'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Minus, Pencil, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildChecklist, type ChecklistItem, type ChecklistStatus } from '@/lib/labels/checklist';
import { type ComparisonStatus } from '@/lib/labels/compare-expected';
import { type CorrectableField, type CorrectionValues } from '@/lib/labels/corrections';
import { type ExpectedValues, type LabelFieldId } from '@/lib/labels/reading';
import { type LabelReport } from '@/lib/labels/verify-label';
import { cn } from '@/lib/utils';
import { highlightHandlers, type OnHighlight } from './highlight';
import { RequirementInfo } from './requirement-info';
import WarningDiff from './warning-diff';

interface Props {
  report: LabelReport;
  saving: boolean;
  onHighlight: OnHighlight;
  onSave(values: { expected: ExpectedValues; corrections: CorrectionValues }): void;
}

const STATUS_LOOK: Record<ChecklistStatus, { Icon: typeof Check; icon: string; row: string; text: string }> = {
  fail: { Icon: X, icon: 'text-status-problem', row: 'bg-destructive/[0.06]', text: 'text-status-problem' },
  review: { Icon: AlertTriangle, icon: 'text-status-review', row: 'bg-warning/10', text: 'text-status-review' },
  pass: { Icon: Check, icon: 'text-status-good', row: '', text: '' },
  not_checked: { Icon: Minus, icon: 'text-muted-foreground', row: '', text: '' },
};

const STATUS_WORDS: Record<ChecklistStatus, string> = {
  fail: 'Problem',
  review: 'Needs a look',
  pass: 'Passes',
  not_checked: 'Not checked',
};

const COMPARISON_TEXT: Partial<Record<ComparisonStatus, { text: string; className: string }>> = {
  match: { text: 'Matches the label', className: 'text-status-good' },
  differs: { text: 'Differs from the label', className: 'text-status-review' },
  not_found_on_label: { text: 'Not on the label', className: 'text-status-review' },
};

/**
 * Everything about each item in one place: whether it passes and why not,
 * what the label says (fixable, with the fix tracked), and the optional
 * application value it is compared with.
 */
export function LabelChecklist({ report, saving, onHighlight, onSave }: Props) {
  const items = useMemo(() => buildChecklist(report), [report]);
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

  function startEditing(item: ChecklistItem) {
    setEditing((current) => new Set(current).add(item.field));
    setCorrections((current) => (item.field in current ? current : { ...current, [item.field]: item.readValue }));
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
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((item) => (
          <ChecklistRow
            key={item.field}
            item={item}
            onHighlight={onHighlight}
            editing={editing.has(item.field)}
            draft={corrections[item.field]}
            onDraft={(value) => setCorrections((current) => ({ ...current, [item.field]: value }))}
            onEdit={() => startEditing(item)}
            onUndo={() => undoCorrection(item.field)}
            expected={item.field === 'governmentWarning' ? null : (expected[item.field] ?? '')}
            onExpected={(value) => setExpected((current) => ({ ...current, [item.field as LabelFieldId]: value }))}
          />
        ))}
      </ul>
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

interface RowProps {
  item: ChecklistItem;
  onHighlight: OnHighlight;
  editing: boolean;
  /** The pending correction; undefined when the field is not being corrected. */
  draft: string | null | undefined;
  onDraft(value: string | null): void;
  onEdit(): void;
  onUndo(): void;
  /** Null for the warning, which has no application value. */
  expected: string | null;
  onExpected(value: string): void;
}

function ChecklistRow({ item, onHighlight, editing, draft, onDraft, onEdit, onUndo, expected, onExpected }: RowProps) {
  const correctionId = useId();
  const expectedId = useId();
  const look = STATUS_LOOK[item.status];
  const isWarning = item.field === 'governmentWarning';
  const corrected = draft !== undefined;
  const shown = corrected ? draft : item.readValue;
  const comparison = item.comparison ? COMPARISON_TEXT[item.comparison.status] : undefined;
  // A failing warning is shown as a word diff, which already contains its text.
  const showDiff = isWarning && item.status === 'fail' && !!item.value;

  return (
    <li
      {...highlightHandlers(item.field, onHighlight)}
      className={cn('grid gap-x-6 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_15rem]', look.row, 'hover:bg-sky-500/5 focus-within:bg-sky-500/5')}
    >
      <div className={cn('flex min-w-0 flex-col gap-1.5', isWarning && 'lg:col-span-2')}>
        <div className="flex items-center gap-2">
          <look.Icon aria-hidden className={cn('size-5 shrink-0', look.icon)} />
          <span className="text-base font-semibold">{item.label}</span>
          <span className="sr-only">{STATUS_WORDS[item.status]}</span>
          <RequirementInfo label={item.label} requirement={item.requirement} />
        </div>

        {editing ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={correctionId} className="text-sm text-muted-foreground">
              {isWarning
                ? 'Type the warning exactly as it appears, including capital letters.'
                : 'What the label actually says (leave empty if it is not on the label)'}
            </label>
            {isWarning ? (
              <textarea
                id={correctionId}
                rows={4}
                value={draft ?? ''}
                onChange={(event) => onDraft(event.target.value || null)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <Input id={correctionId} value={draft ?? ''} onChange={(event) => onDraft(event.target.value || null)} className="h-11 text-base" />
            )}
          </div>
        ) : showDiff ? null : (
          <div className="flex flex-wrap items-center gap-2 pl-7">
            <span className={cn(isWarning && 'font-mono text-sm leading-relaxed', !shown && 'text-muted-foreground')}>
              {shown ?? (isWarning ? 'No warning was found on the label.' : 'Not found on the label')}
            </span>
            {!corrected && item.readValue && item.lowConfidence ? (
              <span className="rounded bg-warning/25 px-1.5 py-0.5 text-xs font-semibold text-status-review">Hard to read</span>
            ) : null}
          </div>
        )}

        {item.reason ? <p className={cn('pl-7 text-base', look.text)}>{item.reason}</p> : null}
        {showDiff && !editing ? (
          <div className="pl-7">
            <WarningDiff extracted={item.value!} />
          </div>
        ) : null}
        {corrected && !editing ? (
          <p className="pl-7 text-sm text-muted-foreground">
            <CorrectionNote item={item} />
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 pl-7">
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
      </div>

      {expected !== null ? (
        <div className="flex flex-col gap-1 pl-7 lg:pl-0">
          <label htmlFor={expectedId} className="text-sm text-muted-foreground">
            In the application (optional)
          </label>
          <Input id={expectedId} value={expected} onChange={(event) => onExpected(event.target.value)} className="h-11 text-base" />
          {comparison ? <p className={cn('text-sm font-semibold', comparison.className)}>{comparison.text}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

const LINK_BUTTON = 'inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:no-underline';

/** "Read as X · corrected by JP", "Confirmed by JP", or a not-yet-saved note. */
function CorrectionNote({ item }: { item: ChecklistItem }) {
  const saved = item.correction;
  if (!saved) return <>Not saved yet.</>;
  const by = saved.reviewer ? ` by ${saved.reviewer}` : '';
  if (item.correctionKind === 'confirmed') return <>Confirmed{by}.</>;
  const original = item.readValue && item.readValue.length > 60 ? `${item.readValue.slice(0, 60)}…` : item.readValue;
  return (
    <>
      Read as “{original ?? 'nothing'}” · corrected{by}. The original reading is kept.
    </>
  );
}

function correctionDrafts(report: LabelReport): CorrectionValues {
  return Object.fromEntries(Object.entries(report.corrections).map(([field, correction]) => [field, correction?.value ?? null]));
}

function cleanExpected(expected: ExpectedValues): ExpectedValues {
  return Object.fromEntries(Object.entries(expected).flatMap(([field, value]) => (value?.trim() ? [[field, value.trim()]] : [])));
}

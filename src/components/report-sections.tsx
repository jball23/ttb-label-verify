'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { type ResultLine } from '@/lib/results/result-types';
import { type FieldStatus } from '@/lib/validation/types';
import {
  type CrossCheckFieldId,
  type CrossCheckStatus,
  CROSS_CHECK_FIELDS,
  CROSS_CHECK_FIELD_LABELS,
} from '@/lib/cross-check/types';
import { RULES } from '@/lib/validation/engine';
import { type FieldPath, type ProvenanceMap } from '@/lib/extraction/types';
import { cn } from '@/lib/utils';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

// Two paths per cross-check row — one for the application side (Item N on
// the form) and one for the label side. Clicking each highlights the
// corresponding region on the PDF.
const CROSS_CHECK_PATHS: Record<
  CrossCheckFieldId,
  { app: FieldPath | null; label: FieldPath | null }
> = {
  brandName: { app: 'application.brandName', label: 'label.brandName' },
  classType: { app: 'application.classType', label: 'label.classType' },
  producer: { app: 'application.applicant.name', label: 'label.producer' },
  countryOfOrigin: { app: null, label: 'label.countryOfOrigin' },
  wineVarietal: { app: 'application.grapeVarietals', label: 'label.wineVarietal' },
  wineAppellation: {
    app: 'application.wineAppellation',
    label: 'label.wineAppellation',
  },
};

const RULE_TO_LABEL_PATH: Record<string, FieldPath | null> = {
  brand: 'label.brandName',
  abv: 'label.abv',
  governmentWarning: 'label.governmentWarning',
  netContents: 'label.netContents',
  classType: 'label.classType',
  producerOrigin: 'label.producer',
};

type FormField = {
  key: string;
  label: string;
  path: FieldPath | null;
  value: (form: WireReport['extractedForm']) => string | null;
};
const APP_FORM_FIELDS: ReadonlyArray<FormField> = [
  { key: 'plantRegistry', label: 'Plant registry / permit (Item 2)', path: 'application.plantRegistryNumber', value: (f) => f.plantRegistryNumber },
  { key: 'source', label: 'Source of product (Item 3)', path: 'application.source', value: (f) => f.source },
  { key: 'serial', label: 'Serial number (Item 4)', path: 'application.serialNumber', value: (f) => f.serialNumber },
  { key: 'productType', label: 'Type of product (Item 5)', path: 'application.productType', value: (f) => f.productType },
  { key: 'brandName', label: 'Brand name (Item 6)', path: 'application.brandName', value: (f) => f.brandName },
  { key: 'fancifulName', label: 'Fanciful name (Item 7)', path: 'application.fancifulName', value: (f) => f.fancifulName },
  { key: 'applicantName', label: 'Applicant name (Item 8)', path: 'application.applicant.name', value: (f) => f.applicant.name },
  { key: 'applicantAddress', label: 'Applicant street address (Item 8)', path: 'application.applicant.address', value: (f) => f.applicant.addressLine1 },
  { key: 'applicantCity', label: 'Applicant city (Item 8)', path: 'application.applicant.city', value: (f) => f.applicant.city },
  { key: 'applicantState', label: 'Applicant state (Item 8)', path: 'application.applicant.state', value: (f) => f.applicant.state },
  { key: 'grape', label: 'Grape varietal (Item 10)', path: 'application.grapeVarietals', value: (f) => f.grapeVarietals },
  { key: 'appellation', label: 'Wine appellation (Item 11)', path: 'application.wineAppellation', value: (f) => f.wineAppellation },
  { key: 'phone', label: 'Phone (Item 12)', path: 'application.phone', value: (f) => f.phone },
  { key: 'email', label: 'Email (Item 13)', path: 'application.email', value: (f) => f.email },
  { key: 'appType', label: 'Type of application (Item 14)', path: 'application.applicationType', value: (f) => f.applicationType },
  { key: 'date', label: 'Date of application (Item 16)', path: 'application.applicationDate', value: (f) => f.applicationDate },
  { key: 'signer', label: 'Printed name of applicant (Item 18)', path: 'application.applicantSignatureName', value: (f) => f.applicantSignatureName },
];

// ---------------------------------------------------------------------------

function statusToDotColor(status: FieldStatus | null): string {
  switch (status) {
    case 'pass':
      return 'bg-emerald-500';
    case 'fail':
      return 'bg-rose-500';
    case 'uncertain':
      return 'bg-amber-500';
    default:
      return 'bg-muted';
  }
}

function crossCheckStatusToDot(status: CrossCheckStatus): string {
  switch (status) {
    case 'match':
      return 'bg-emerald-500';
    case 'mismatch':
      return 'bg-rose-500';
    case 'not_on_label':
      return 'bg-amber-500';
    case 'not_on_application':
      // Informational only — label declares a value the application didn't.
      // Common for Item 7 (fanciful name), which is optional on the form.
      return 'bg-sky-500';
    default:
      return 'bg-muted';
  }
}

// ---------------------------------------------------------------------------

export function CrossCheckSection({
  report,
  selectedFieldId,
  onSelect,
  provenance,
}: {
  report: WireReport['crossCheck'];
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Cross-check (application vs label)</h2>
          <p className="text-[11px] text-muted-foreground">
            Click the App or Label side of any row to highlight that source on the PDF.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {CROSS_CHECK_FIELDS.map((id) => {
            const f = report.fields[id];
            if (!f || f.status === 'not_applicable') return null;
            return (
              <span
                key={id}
                title={`${CROSS_CHECK_FIELD_LABELS[id]}: ${f.status}`}
                aria-label={`${CROSS_CHECK_FIELD_LABELS[id]}: ${f.status}`}
                className={cn(
                  'inline-block size-2.5 rounded-full',
                  crossCheckStatusToDot(f.status),
                )}
              />
            );
          })}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {CROSS_CHECK_FIELDS.map((id) => {
          const field = report.fields[id];
          if (!field || field.status === 'not_applicable') return null;
          const paths = CROSS_CHECK_PATHS[id];

          return (
            <li key={id} className="px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <CrossCheckIcon status={field.status} />
                <span className="text-xs font-medium">
                  {CROSS_CHECK_FIELD_LABELS[id]}
                </span>
              </div>
              <div className="space-y-1 pl-6">
                <SideRow
                  side="Application"
                  value={field.applicationValue}
                  path={paths.app}
                  selectedFieldId={selectedFieldId}
                  onSelect={onSelect}
                  provenance={provenance}
                />
                <SideRow
                  side="Label"
                  value={field.labelValue}
                  path={paths.label}
                  selectedFieldId={selectedFieldId}
                  onSelect={onSelect}
                  provenance={provenance}
                />
              </div>
              {field.reason && (
                <p className="mt-1 pl-6 text-[11px] text-rose-600">{field.reason}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SideRow({
  side,
  value,
  path,
  selectedFieldId,
  onSelect,
  provenance,
}: {
  side: 'Application' | 'Label';
  value: string | null;
  path: FieldPath | null;
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
}) {
  const provenanceEntry = path ? provenance[path] : undefined;
  const selected = path !== null && path === selectedFieldId;
  const sideLabel = side === 'Application' ? 'App: ' : 'Label: ';
  return (
    <button
      type="button"
      onClick={() => path && onSelect(path)}
      disabled={!path || !provenanceEntry}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors',
        path && provenanceEntry
          ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
          : 'cursor-default text-muted-foreground',
        selected && 'bg-accent/60',
      )}
    >
      <span className="w-16 shrink-0 text-muted-foreground">{sideLabel}</span>
      <span className="truncate text-foreground/90">{value ?? '—'}</span>
      {provenanceEntry?.confidence === 'low' && (
        <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-600">
          Low
        </span>
      )}
    </button>
  );
}

export function RulesSection({
  fields,
  selectedFieldId,
  onSelect,
  provenance,
}: {
  fields: Record<string, { status: FieldStatus; reason?: string; extractedValue?: string | null }>;
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
}) {
  const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Close the open tooltip on outside click or Escape. The dialog is rendered
  // via a portal (to escape ancestor `overflow:clip`/stacking contexts), so
  // it lives outside `sectionRef`'s DOM subtree — `[data-cfr-tooltip]` is the
  // only marker we can rely on for "is this click inside the tooltip system."
  useEffect(() => {
    if (!openTooltipId) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as Element | null;
      const inside = target?.closest?.('[data-cfr-tooltip]');
      if (!inside) setOpenTooltipId(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpenTooltipId(null);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openTooltipId]);

  return (
    <section ref={sectionRef} className="rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">TTB label rules</h2>
          <p className="text-[11px] text-muted-foreground">
            Six label-only rules. Click the ⓘ to see the actual CFR citation.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {RULES.map((rule) => {
            const status = fields[rule.id]?.status ?? null;
            return (
              <span
                key={rule.id}
                title={`${rule.label}: ${status ?? 'pending'}`}
                aria-label={`${rule.label}: ${status ?? 'pending'}`}
                className={cn('inline-block size-2.5 rounded-full', statusToDotColor(status))}
              />
            );
          })}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {RULES.map((rule) => {
          const result = fields[rule.id];
          const path = RULE_TO_LABEL_PATH[rule.id] ?? null;
          const provenanceEntry = path ? provenance[path] : undefined;
          const selected = path !== null && path === selectedFieldId;
          return (
            <li key={rule.id} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <RuleIcon status={result?.status ?? null} />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => path && onSelect(path)}
                      disabled={!path || !provenanceEntry}
                      aria-pressed={selected}
                      className={cn(
                        'truncate text-xs font-medium',
                        path && provenanceEntry
                          ? 'cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm'
                          : 'cursor-default',
                        selected && 'text-foreground',
                      )}
                    >
                      {rule.label}
                    </button>
                    <CfrTooltip
                      cfr={rule.cfr}
                      open={openTooltipId === rule.id}
                      onToggle={() =>
                        setOpenTooltipId((cur) => (cur === rule.id ? null : rule.id))
                      }
                    />
                  </div>
                  {result?.extractedValue && (
                    <p className="text-[11px] text-muted-foreground">
                      Read: <span className="text-foreground/80">{result.extractedValue}</span>
                    </p>
                  )}
                  {result?.reason && result.status !== 'pass' && (
                    <p className="text-[11px] text-rose-600">{result.reason}</p>
                  )}
                </div>
                {provenanceEntry?.confidence === 'low' && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-600">
                    Low
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CfrTooltip({
  cfr,
  open,
  onToggle,
}: {
  cfr: import('@/lib/validation/types').CfrCitation;
  open: boolean;
  onToggle(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="inline-block" data-cfr-tooltip>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Show CFR citation: ${cfr.section}`}
        aria-expanded={open}
        onClick={onToggle}
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <ChevronUp className="size-3" /> : <Info className="size-3" />}
      </button>
      {open && <CfrTooltipDialog cfr={cfr} anchor={triggerRef} />}
    </span>
  );
}

/**
 * The popover dialog itself, rendered via a portal to document.body so it
 * escapes any ancestor `overflow:clip` and stacking contexts (the queue row
 * uses overflow:clip for rounded-card clipping; without the portal the
 * dialog gets cut off below the row). Positioned with `fixed` coordinates
 * derived from the trigger's bounding rect.
 */
function CfrTooltipDialog({
  cfr,
  anchor,
}: {
  cfr: import('@/lib/validation/types').CfrCitation;
  anchor: React.RefObject<HTMLButtonElement | null>;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Width must match the dialog's rendered width — used both as a Tailwind
  // class below and as the clamping constant here. 320 = w-80.
  const DIALOG_WIDTH = 320;
  const VIEWPORT_MARGIN = 8;

  // useLayoutEffect so the dialog never paints at (0,0) before being moved.
  useLayoutEffect(() => {
    function reposition(): void {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      // Prefer right-aligning the dialog with the trigger's right edge (so
      // it visually "hangs" from the ⓘ icon). Then clamp to the viewport so
      // the panel never disappears off the left/right edges.
      const idealLeft = rect.right - DIALOG_WIDTH;
      const maxLeft = window.innerWidth - DIALOG_WIDTH - VIEWPORT_MARGIN;
      const clampedLeft = Math.max(
        VIEWPORT_MARGIN,
        Math.min(idealLeft, maxLeft),
      );
      setCoords({ top: rect.bottom + 4, left: clampedLeft });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchor]);

  if (!coords) return null;
  return createPortal(
    <div
      role="dialog"
      aria-label={cfr.section}
      data-cfr-tooltip
      style={{ position: 'fixed', top: coords.top, left: coords.left }}
      className="z-50 w-80 rounded-md border border-border bg-popover p-3 text-[11px] shadow-md"
    >
      <p className="font-semibold text-foreground">{cfr.section}</p>
      <p className="mt-1 text-foreground/80">{cfr.summary}</p>
      <p className="mt-2 border-l-2 border-border pl-2 italic text-muted-foreground">
        {cfr.quote}
      </p>
    </div>,
    document.body,
  );
}

export function ApplicationFieldsSection({
  form,
  selectedFieldId,
  onSelect,
  provenance,
}: {
  form: WireReport['extractedForm'];
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold">Application form fields</h2>
          <p className="text-[11px] text-muted-foreground">
            Every value the extractor read off Form 5100.31. Click to highlight on the PDF.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <ul className="divide-y divide-border">
          {APP_FORM_FIELDS.map((field) => {
            const value = field.value(form);
            const provenanceEntry = field.path ? provenance[field.path] : undefined;
            const selected = field.path !== null && field.path === selectedFieldId;
            return (
              <li key={field.key}>
                <button
                  type="button"
                  onClick={() => field.path && onSelect(field.path)}
                  disabled={!field.path || !provenanceEntry}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors',
                    field.path && provenanceEntry
                      ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                      : 'cursor-default',
                    selected && 'bg-accent/60',
                  )}
                >
                  <span className="w-44 shrink-0 text-[11px] text-muted-foreground">
                    {field.label}
                  </span>
                  <span className="flex-1 truncate text-xs text-foreground/90">
                    {value && value.trim().length > 0 ? (
                      value
                    ) : (
                      <span className="italic text-muted-foreground">not extracted</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CrossCheckIcon({ status }: { status: CrossCheckStatus }) {
  if (status === 'match') return <Check className="size-3.5 text-emerald-600" />;
  if (status === 'mismatch') return <X className="size-3.5 text-rose-600" />;
  if (status === 'not_on_label') return <AlertTriangle className="size-3.5 text-amber-600" />;
  if (status === 'not_on_application') return <Info className="size-3.5 text-sky-600" />;
  return <HelpCircle className="size-3.5 text-muted-foreground" />;
}

function RuleIcon({ status }: { status: FieldStatus | null }) {
  if (status === 'pass') return <Check className="mt-0.5 size-3.5 text-emerald-600" />;
  if (status === 'fail') return <X className="mt-0.5 size-3.5 text-rose-600" />;
  if (status === 'uncertain') return <AlertTriangle className="mt-0.5 size-3.5 text-amber-600" />;
  return <HelpCircle className="mt-0.5 size-3.5 text-muted-foreground" />;
}

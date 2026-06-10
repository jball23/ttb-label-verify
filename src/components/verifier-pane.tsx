'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, X, AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';
import { type ResultLine } from '@/lib/results/result-types';
import { type FieldStatus } from '@/lib/validation/types';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];
import {
  type CrossCheckFieldId,
  type CrossCheckFieldResult,
  type CrossCheckStatus,
  CROSS_CHECK_FIELDS,
  CROSS_CHECK_FIELD_LABELS,
} from '@/lib/cross-check/types';
import { RULES } from '@/lib/validation/engine';
import { type FieldPath, type ProvenanceMap } from '@/lib/extraction/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// react-pdf is heavy and client-only — split it out of the initial bundle.
const PdfViewer = dynamic(() => import('./pdf-viewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[400px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
      Loading PDF viewer…
    </div>
  ),
});

interface Props {
  pdfFile: File;
  result: ResultLine | null;
  isStreaming: boolean;
  onStartOver(): void;
}

// Maps each cross-check field id to the FieldPath used in provenance keys for
// the *form* side. Clicking a cross-check row highlights the application's
// version (because the cross-check engine is checking that the form's
// declaration matches the label).
const CROSS_CHECK_TO_APPLICATION_PATH: Record<CrossCheckFieldId, FieldPath | null> = {
  brandName: 'application.brandName',
  classType: 'application.classType',
  producer: 'application.applicant.name',
  countryOfOrigin: null,
  wineVarietal: 'application.grapeVarietals',
  wineAppellation: 'application.wineAppellation',
};

// Maps each rule id to the label-side provenance path that drove the verdict.
const RULE_TO_LABEL_PATH: Record<string, FieldPath | null> = {
  brand: 'label.brandName',
  abv: 'label.abv',
  governmentWarning: 'label.governmentWarning',
  netContents: 'label.netContents',
  classType: 'label.classType',
  producerOrigin: 'label.producer',
};

export default function VerifierPane({
  pdfFile,
  result,
  isStreaming,
  onStartOver,
}: Props) {
  const [selectedFieldId, setSelectedFieldId] = useState<FieldPath | null>(null);

  function select(path: FieldPath | null): void {
    setSelectedFieldId((current) => (current === path ? null : path));
  }

  const report = result && result.status === 'ok' ? result.report : null;
  const provenance: ProvenanceMap = report?.provenance ?? {};
  const verdict = report?.overallStatus ?? null;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">
            {pdfFile.name}
          </h1>
          {verdict && <VerdictBadge verdict={verdict} />}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Verifying…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onStartOver}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Start over
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="max-h-[80vh] overflow-y-auto">
            <PdfViewer
              pdfFile={pdfFile}
              provenance={provenance}
              selectedFieldId={selectedFieldId}
            />
          </div>
        </div>

        <div className="space-y-4">
          {result && result.status === 'error' && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">Verification failed</p>
              <p className="mt-1 text-xs">{result.errorMessage}</p>
            </div>
          )}

          {report && (
            <>
              <SummaryDots report={report} />
              <CrossCheckSection
                report={report.crossCheck}
                selectedFieldId={selectedFieldId}
                onSelect={select}
                provenance={provenance}
              />
              <RulesSection
                fields={report.fields}
                selectedFieldId={selectedFieldId}
                onSelect={select}
                provenance={provenance}
              />
            </>
          )}

          {!report && isStreaming && (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
              Reading the COLA application and the label…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: 'compliant' | 'needs_review' }) {
  return (
    <Badge variant={verdict === 'compliant' ? 'default' : 'destructive'}>
      {verdict === 'compliant' ? 'Compliant' : 'Needs review'}
    </Badge>
  );
}

function SummaryDots({ report }: { report: WireReport }) {
  const xc = report.crossCheck.overallStatus;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
      <span
        title={`Cross-check ${xc}`}
        className={cn(
          'inline-block size-3 rounded-full ring-2 ring-offset-1 ring-offset-background',
          xc === 'match' ? 'bg-emerald-500 ring-emerald-200' : 'bg-amber-500 ring-amber-200',
        )}
        aria-label={`Cross-check ${xc}`}
      />
      <span className="text-muted-foreground">XC</span>
      <span className="ml-2 inline-block h-3 w-px bg-border" />
      {RULES.map((rule) => {
        const status = report.fields[rule.id]?.status ?? null;
        return (
          <span
            key={rule.id}
            title={`${rule.label}: ${status ?? 'pending'}`}
            className={cn(
              'inline-block size-2.5 rounded-full',
              statusToDotColor(status),
            )}
            aria-label={`${rule.label}: ${status ?? 'pending'}`}
          />
        );
      })}
    </div>
  );
}

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

function CrossCheckSection({
  report,
  selectedFieldId,
  onSelect,
  provenance,
}: {
  report: {
    overallStatus: 'match' | 'mismatch';
    fields: Partial<Record<CrossCheckFieldId, CrossCheckFieldResult>>;
  };
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Cross-check (application vs label)</h2>
        <p className="text-[11px] text-muted-foreground">
          Click any row to highlight its source on the PDF.
        </p>
      </header>
      <ul className="divide-y divide-border">
        {CROSS_CHECK_FIELDS.map((id) => {
          const field = report.fields[id];
          if (!field || field.status === 'not_applicable') return null;
          const path = CROSS_CHECK_TO_APPLICATION_PATH[id];
          const provenanceEntry = path ? provenance[path] : undefined;
          const selected = path === selectedFieldId && path !== null;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                disabled={!path || !provenanceEntry}
                aria-pressed={selected}
                className={cn(
                  'flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors',
                  path && provenanceEntry
                    ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                    : 'cursor-default',
                  selected && 'bg-accent/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <CrossCheckIcon status={field.status} />
                  <span className="text-xs font-medium">
                    {CROSS_CHECK_FIELD_LABELS[id]}
                  </span>
                  {provenanceEntry?.confidence === 'low' && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-600">
                      Low confidence
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-2 pl-6 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    App:&nbsp;<span className="text-foreground/80">{field.applicationValue ?? '—'}</span>
                  </span>
                  <span className="truncate">
                    Label:&nbsp;<span className="text-foreground/80">{field.labelValue ?? '—'}</span>
                  </span>
                </div>
                {field.reason && (
                  <p className="pl-6 text-[11px] text-rose-600">{field.reason}</p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RulesSection({
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
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">TTB label rules</h2>
        <p className="text-[11px] text-muted-foreground">
          Six label-only rules. Click a row to see the source field on the label.
        </p>
      </header>
      <ul className="divide-y divide-border">
        {RULES.map((rule) => {
          const result = fields[rule.id];
          const path = RULE_TO_LABEL_PATH[rule.id] ?? null;
          const provenanceEntry = path ? provenance[path] : undefined;
          const selected = path === selectedFieldId && path !== null;
          return (
            <li key={rule.id}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                disabled={!path || !provenanceEntry}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                  path && provenanceEntry
                    ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                    : 'cursor-default',
                  selected && 'bg-accent/60',
                )}
              >
                <RuleIcon status={result?.status ?? null} />
                <div className="flex-1">
                  <p className="text-xs font-medium">{rule.label}</p>
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
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CrossCheckIcon({ status }: { status: CrossCheckStatus }) {
  if (status === 'match') return <Check className="size-3.5 text-emerald-600" />;
  if (status === 'mismatch') return <X className="size-3.5 text-rose-600" />;
  if (status === 'not_on_label') return <AlertTriangle className="size-3.5 text-amber-600" />;
  return <HelpCircle className="size-3.5 text-muted-foreground" />;
}

function RuleIcon({ status }: { status: FieldStatus | null }) {
  if (status === 'pass') return <Check className="mt-0.5 size-3.5 text-emerald-600" />;
  if (status === 'fail') return <X className="mt-0.5 size-3.5 text-rose-600" />;
  if (status === 'uncertain') return <AlertTriangle className="mt-0.5 size-3.5 text-amber-600" />;
  return <HelpCircle className="mt-0.5 size-3.5 text-muted-foreground" />;
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  Loader2,
  FileText,
  Clock,
  ChevronDown,
  Maximize2,
} from 'lucide-react';
import { type ResultLine } from '@/lib/results/result-types';
import { type FieldStatus } from '@/lib/validation/types';
import { RULES } from '@/lib/validation/engine';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Disclosure } from '@/components/ui/disclosure';
import { ImageInspector } from '@/components/image-inspector';
import { cn } from '@/lib/utils';
import WarningDiff from './warning-diff';

interface Props {
  file: File;
  result: ResultLine | undefined;
  defaultOpen?: boolean;
}

export default function ResultCard({ file, result, defaultOpen = false }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultOpen);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Auto-open the card when its result lands, so users see the verdict immediately.
  useEffect(() => {
    if (result && result.status === 'ok' && result.report.overallStatus !== 'compliant') {
      setExpanded(true);
    }
  }, [result]);

  const isPending = !result;

  const fieldStatuses = useMemo(() => {
    if (!result || result.status !== 'ok') return null;
    return RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      status: result.report.fields[rule.id]?.status ?? null,
    }));
  }, [result]);

  return (
    <>
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-all',
          !isPending && 'animate-in fade-in-0 duration-300',
        )}
      >
        {/* Header — always visible, clickable to toggle */}
        <button
          type="button"
          onClick={() => !isPending && setExpanded((e) => !e)}
          disabled={isPending}
          aria-expanded={expanded}
          className={cn(
            'group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors sm:px-4',
            !isPending &&
              'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          )}
        >
          {/* Thumbnail — clickable separately to open inspector */}
          <div
            onClick={(e) => {
              if (!thumbUrl) return;
              e.stopPropagation();
              setInspectorOpen(true);
            }}
            role={thumbUrl ? 'button' : undefined}
            aria-label={thumbUrl ? `Inspect ${file.name}` : undefined}
            tabIndex={thumbUrl ? 0 : -1}
            onKeyDown={(e) => {
              if (!thumbUrl) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setInspectorOpen(true);
              }
            }}
            className={cn(
              'relative size-14 shrink-0 overflow-hidden rounded-md border border-border bg-background sm:size-16',
              thumbUrl &&
                'cursor-zoom-in transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {thumbUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl}
                  alt={`Preview of ${file.name}`}
                  className="size-full object-cover"
                />
                {!isPending && (
                  <span className="pointer-events-none absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 className="m-1 size-3 text-white" />
                  </span>
                )}
              </>
            ) : (
              <div className="flex size-full items-center justify-center bg-muted">
                <FileText className="size-4 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Filename + verdict + meta */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium">{file.name}</p>
              {!isPending && (
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <VerdictBadge result={result} />
              {result?.status === 'ok' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                  <Clock className="size-3" />
                  {(result.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              {/* Six-dot field summary — at-a-glance scan */}
              {fieldStatuses && (
                <div
                  className="flex items-center gap-1"
                  role="img"
                  aria-label="Field check summary"
                >
                  {fieldStatuses.map((f) => (
                    <SummaryDot
                      key={f.id}
                      status={f.status}
                      title={`${f.label}: ${f.status ?? 'unknown'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </button>

        {/* Expanded body */}
        <div
          className={cn(
            'grid transition-all duration-200',
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border px-3 py-4 sm:px-4">
              {isPending && <PendingBody />}
              {result?.status === 'error' && (
                <p className="text-sm text-[var(--destructive)]">{result.errorMessage}</p>
              )}
              {result?.status === 'ok' && <OkBody result={result} />}
            </div>
          </div>
        </div>
      </div>

      <ImageInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        imageUrl={thumbUrl}
        alt={file.name}
      />
    </>
  );
}

function VerdictBadge({ result }: { result: ResultLine | undefined }) {
  if (!result) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Loader2 className="size-3 animate-spin" />
        Checking…
      </Badge>
    );
  }
  if (result.status === 'error') {
    return (
      <Badge variant="destructive">
        <X className="size-3" />
        Error
      </Badge>
    );
  }
  if (result.report.overallStatus === 'compliant') {
    return (
      <Badge variant="success">
        <Check className="size-3" />
        Compliant
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <AlertTriangle className="size-3" />
      Needs review
    </Badge>
  );
}

function SummaryDot({ status, title }: { status: FieldStatus | null; title: string }) {
  const colorClass = !status
    ? 'bg-muted-foreground/30'
    : status === 'pass'
      ? 'bg-[var(--success)]'
      : status === 'fail'
        ? 'bg-[var(--destructive)]'
        : 'bg-[var(--warning)]';
  return <span className={cn('size-1.5 rounded-full', colorClass)} title={title} />;
}

function PendingBody() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function OkBody({ result }: { result: Extract<ResultLine, { status: 'ok' }> }) {
  const warningField = result.report.fields.governmentWarning;
  const otherFails = Object.entries(result.report.fields).filter(
    ([id, f]) => id !== 'governmentWarning' && f.status !== 'pass',
  );
  const hasOtherFail = otherFails.some(([, f]) => f.status === 'fail');
  const hasDisclosures =
    (warningField && warningField.status !== 'pass') || otherFails.length > 0;

  return (
    <div className="space-y-4">
      {/* Two-column field layout on larger screens for density */}
      <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {RULES.map((rule) => {
          const field = result.report.fields[rule.id];
          if (!field) return null;
          return (
            <li key={rule.id} className="flex items-start gap-3">
              <StatusIcon status={field.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-tight text-foreground">
                  {rule.label}
                </p>
                <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                  {field.extractedValue ?? <span className="italic">Not detected</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {hasDisclosures && (
        <div className="space-y-2 pt-1">
          {warningField && warningField.status !== 'pass' && (
            <Disclosure
              title={
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      warningField.status === 'fail'
                        ? 'bg-[var(--destructive)]'
                        : 'bg-[var(--warning)]',
                    )}
                  />
                  Why the Government Warning was flagged
                </span>
              }
              defaultOpen
            >
              <p className="mb-3 text-xs text-muted-foreground">{warningField.reason}</p>
              <WarningDiff extracted={warningField.extractedValue ?? null} />
            </Disclosure>
          )}
          {otherFails.length > 0 && (
            <Disclosure
              title={
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      hasOtherFail ? 'bg-[var(--destructive)]' : 'bg-[var(--warning)]',
                    )}
                  />
                  Other issues ({otherFails.length})
                </span>
              }
            >
              <ul className="space-y-2">
                {otherFails.map(([id, f]) => {
                  const rule = RULES.find((r) => r.id === id);
                  return (
                    <li key={id} className="text-xs">
                      <span className="font-medium">{rule?.label ?? id}: </span>
                      <span className="text-muted-foreground">
                        {f.reason ?? 'See extracted value above.'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const base =
    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border';
  if (status === 'pass') {
    return (
      <span
        className={cn(
          base,
          'border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]',
        )}
        aria-label="Pass"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span
        className={cn(
          base,
          'border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] text-[var(--destructive)]',
        )}
        aria-label="Fail"
      >
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        'border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]',
      )}
      aria-label="Uncertain"
    >
      <HelpCircle className="size-3" strokeWidth={2.5} />
    </span>
  );
}

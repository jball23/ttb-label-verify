'use client';

import { useState, useEffect } from 'react';
import {
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  Loader2,
  FileText,
  Clock,
} from 'lucide-react';
import { type ResultLine } from '@/lib/results/result-types';
import { RULES } from '@/lib/validation/engine';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/utils';
import WarningDiff from './warning-diff';

interface Props {
  file: File;
  result: ResultLine | undefined;
}

export default function ResultCard({ file, result }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPending = !result;

  return (
    <div
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-all',
        !isPending && 'animate-in fade-in-0 duration-300',
      )}
    >
      {/* Header strip */}
      <div className="flex items-start gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-background">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt={`Preview of ${file.name}`} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted">
              <FileText className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{file.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <VerdictBadge result={result} />
            {result?.status === 'ok' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                <Clock className="size-3" />
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-4">
        {isPending && <PendingBody />}
        {result?.status === 'error' && (
          <p className="text-sm text-[var(--destructive)]">{result.errorMessage}</p>
        )}
        {result?.status === 'ok' && <OkBody result={result} />}
      </div>
    </div>
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
  const hasDisclosures =
    (warningField && warningField.status !== 'pass') || otherFails.length > 0;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {RULES.map((rule) => {
          const field = result.report.fields[rule.id];
          if (!field) return null;
          return (
            <li key={rule.id} className="flex items-start gap-3">
              <StatusIcon status={field.status} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-tight text-foreground">
                  {rule.label}
                </p>
                <p
                  className={cn(
                    'mt-0.5 truncate text-xs leading-tight',
                    field.status === 'fail' ? 'text-muted-foreground' : 'text-muted-foreground',
                  )}
                >
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
                  <span className="size-1.5 rounded-full bg-[var(--warning)]" />
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

'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type LabelView } from '@/lib/labels/label-view';
import { byProblemsFirst, labelTitle, summarizeReport } from '@/lib/labels/presentation';
import { type Verdict } from '@/lib/labels/verdict';
import { cn } from '@/lib/utils';
import { useBatch, type BatchItem } from './batch-provider';
import { LabelDropzone } from './label-dropzone';
import { LabelRow } from './label-row';
import { CheckingChip, DecisionChip, VerdictChip } from './status-chip';

type Order = 'problems' | 'upload';

/** Home: drop labels, watch the batch fill in, open any label to review. */
export function CheckLabelsPage({ waiting }: { waiting: LabelView[] }) {
  const { items } = useBatch();
  const [order, setOrder] = useState<Order>('problems');

  const batchIds = useMemo(() => new Set(items.flatMap((item) => (item.label ? [item.label.id] : []))), [items]);
  const earlier = useMemo(
    () => waiting.filter((view) => !batchIds.has(view.id)).sort(byProblemsFirst),
    [waiting, batchIds],
  );
  const shown = useMemo(() => (order === 'problems' ? sortProblemsFirst(items) : items), [items, order]);

  if (items.length === 0 && earlier.length === 0) {
    return (
      <Page>
        <Heading title="Check labels" subtitle="Each label is read and checked against TTB requirements in a few seconds." />
        <LabelDropzone />
      </Page>
    );
  }

  return (
    <Page>
      <Heading title="Check labels" subtitle="Open any label to look closely, fix a reading, compare it with the application and decide." />
      <LabelDropzone compact />

      {items.length > 0 ? (
        <section aria-labelledby="batch-heading" className="flex flex-col gap-4">
          <BatchProgress items={items} />
          <div className="flex items-center justify-between gap-4">
            <h2 id="batch-heading" className="text-xl font-semibold">
              This batch
            </h2>
            <OrderToggle value={order} onChange={setOrder} />
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {shown.map((item) => (
              <BatchRow key={item.key} item={item} />
            ))}
          </ul>
        </section>
      ) : null}

      {earlier.length > 0 ? (
        <section aria-labelledby="earlier-heading" className="flex flex-col gap-4">
          <h2 id="earlier-heading" className="text-xl font-semibold">
            Waiting for review ({earlier.length})
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {earlier.map((view) => (
              <LabelRow
                key={view.id}
                title={labelTitle(view.report, view.filename)}
                detail={summarizeReport(view.report)}
                thumbnailUrl={view.imageUrl}
                chip={<VerdictChip verdict={view.report.verdict} />}
                href={`/labels/${view.id}`}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}

function BatchRow({ item }: { item: BatchItem }) {
  const { retry } = useBatch();
  if (item.status === 'done' && item.label) {
    const { label } = item;
    return (
      <LabelRow
        title={labelTitle(label.report, item.filename)}
        detail={summarizeReport(label.report)}
        thumbnailUrl={item.previewUrl}
        chip={label.status === 'to_review' ? <VerdictChip verdict={label.report.verdict} /> : <DecisionChip status={label.status} />}
        href={`/labels/${label.id}`}
      />
    );
  }
  if (item.status === 'failed') {
    return (
      <LabelRow
        title={item.filename}
        detail={item.error ?? 'This label could not be checked.'}
        thumbnailUrl={item.previewUrl}
        chip={<span className="text-base font-semibold text-status-problem">Not checked</span>}
        action={
          <Button variant="outline" onClick={() => retry(item.key)}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <LabelRow
      title={item.filename}
      detail={item.status === 'queued' ? 'Waiting for a free slot…' : 'Reading the label…'}
      thumbnailUrl={item.previewUrl}
      chip={<CheckingChip queued={item.status === 'queued'} />}
    />
  );
}

function BatchProgress({ items }: { items: BatchItem[] }) {
  const { concurrency, isRunning } = useBatch();
  const finished = items.filter((item) => item.status === 'done' || item.status === 'failed').length;
  const count = (verdict: Verdict) => items.filter((item) => item.label?.report.verdict === verdict).length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const percent = Math.round((finished / items.length) * 100);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-lg">
        <span className="font-semibold tabular-nums">
          {finished} of {items.length} checked
        </span>
        <span className="text-base text-muted-foreground">
          {isRunning ? `Checking ${concurrency} at a time` : 'Done'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Labels checked"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-base font-semibold tabular-nums">
        <span className="text-status-problem">{count('problems_found')} with problems</span>
        <span className="text-status-review">{count('needs_review')} need a look</span>
        <span className="text-status-good">{count('looks_good')} look good</span>
        {failed > 0 ? <span className="text-muted-foreground">{failed} not checked</span> : null}
      </div>
    </div>
  );
}

function OrderToggle({ value, onChange }: { value: Order; onChange(order: Order): void }) {
  const options: Array<[Order, string]> = [
    ['problems', 'Problems first'],
    ['upload', 'Upload order'],
  ];
  return (
    <div role="group" aria-label="Order" className="flex gap-2">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-full border px-4 py-2 text-base font-medium',
            value === key ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Checked labels worst-first; labels still being checked stay at the end. */
function sortProblemsFirst(items: BatchItem[]): BatchItem[] {
  const checked = items.filter((item) => item.label).sort((a, b) => byProblemsFirst(a.label!, b.label!));
  const failed = items.filter((item) => item.status === 'failed');
  const rest = items.filter((item) => !item.label && item.status !== 'failed');
  return [...failed, ...checked, ...rest];
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">{children}</div>;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-lg text-muted-foreground">{subtitle}</p>
    </div>
  );
}

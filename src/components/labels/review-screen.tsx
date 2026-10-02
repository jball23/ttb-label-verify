'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, X } from 'lucide-react';
import { ImageInspector } from './image-inspector';
import WarningDiff from './warning-diff';
import { decide, saveReviewerValues } from '@/lib/labels/client-api';
import { type CorrectableField } from '@/lib/labels/corrections';
import { type LabelView } from '@/lib/labels/label-view';
import { labelTitle } from '@/lib/labels/presentation';
import { type RuleOutcome } from '@/lib/labels/rules/types';
import { type Verdict } from '@/lib/labels/verdict';
import { cn } from '@/lib/utils';
import { useBatch } from './batch-provider';
import { DecisionPanel } from './decision-panel';
import { highlightHandlers, type OnHighlight } from './highlight';
import { LabelPhoto } from './label-photo';
import { ReviewerValuesForm } from './reviewer-values-form';
import { DecisionChip, VerdictChip, VerdictText } from './status-chip';

export interface QueueEntry {
  id: string;
  title: string;
  verdict: Verdict;
  imageUrl: string;
}

/** One label at a time: the photo, what was found, fixes and application values, and the decision. */
export function ReviewScreen({ initial, queue }: { initial: LabelView; queue: QueueEntry[] }) {
  const router = useRouter();
  const { replaceLabel } = useBatch();
  const [view, setView] = useState(initial);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<'saving' | 'deciding' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [highlight, setHighlight] = useState<CorrectableField | null>(null);

  const { report } = view;
  const title = labelTitle(report, view.filename);
  const problems = report.rules.filter((rule) => rule.status !== 'pass');
  const passed = report.rules.filter((rule) => rule.status === 'pass');
  const warningRule = report.rules.find((rule) => rule.id === 'governmentWarning');
  const next = queue.find((entry) => entry.id !== view.id);

  async function run(kind: 'saving' | 'deciding', work: () => Promise<LabelView>) {
    setBusy(kind);
    setError(null);
    try {
      const updated = await work();
      setView(updated);
      setVersion((v) => v + 1);
      replaceLabel(updated);
      return updated;
    } catch (caught) {
      setError((caught as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <ReviewQueue queue={queue} currentId={view.id} />

      <div className="flex min-w-0 flex-col gap-6">
        <Link href="/" className="inline-flex w-fit items-center gap-1 text-base font-medium underline underline-offset-4 lg:hidden">
          <ChevronLeft aria-hidden className="size-4" /> All labels
        </Link>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <figure className="flex flex-col gap-2 xl:sticky xl:top-24 xl:self-start">
            <LabelPhoto
              imageUrl={view.imageUrl}
              alt={`Label photo: ${title}`}
              reading={report.effectiveReading}
              highlight={highlight}
              onZoom={() => setZoomOpen(true)}
            />
            <figcaption className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="font-mono">
                {view.filename} · read in {(view.latencyMs / 1000).toFixed(1)} s
              </span>
              <span>Point at a check or a field to see where it is on the label.</span>
            </figcaption>
          </figure>

          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
              {view.status === 'to_review' ? <VerdictChip verdict={report.verdict} /> : <DecisionChip status={view.status} />}
            </div>

            {!report.effectiveReading.imageQuality.legible || report.effectiveReading.imageQuality.issues.length > 0 ? (
              <div className="flex gap-3 rounded-xl border border-warning/50 bg-warning/15 p-4 text-base">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-status-review" />
                <div>
                  <p className="font-semibold">
                    {report.effectiveReading.imageQuality.legible ? 'Parts of this photo were hard to read.' : 'This photo is too hard to read reliably.'}
                  </p>
                  <p>{report.effectiveReading.imageQuality.issues.join(' · ') || 'Ask the applicant for a clearer photo.'}</p>
                </div>
              </div>
            ) : null}

            <section aria-labelledby="checks-heading" className="flex flex-col gap-3">
              <h2 id="checks-heading" className="text-xl font-semibold">
                {problems.length === 0 ? 'All label checks passed' : 'What needs attention'}
              </h2>
              <ul className="flex flex-col gap-2">
                {problems.map((rule) => (
                  <RuleItem key={rule.id} rule={rule} onHighlight={setHighlight} />
                ))}
              </ul>
              {warningRule?.status === 'fail' && report.effectiveReading.governmentWarning.verbatimText ? (
                <WarningDiff extracted={report.effectiveReading.governmentWarning.verbatimText} />
              ) : null}
              {passed.length > 0 ? (
                <details className="rounded-xl border border-border px-4 py-3">
                  <summary className="cursor-pointer text-base font-medium">
                    {passed.length} {passed.length === 1 ? 'check' : 'checks'} passed
                  </summary>
                  <ul className="mt-3 flex flex-col gap-2">
                    {passed.map((rule) => (
                      <RuleItem key={rule.id} rule={rule} onHighlight={setHighlight} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>

            {error ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-status-problem">
                {error}
              </p>
            ) : null}

            {view.status === 'to_review' ? (
              <DecisionPanel
                busy={busy !== null}
                suggestedReason={problems.map((rule) => rule.reason).join(' ')}
                onDecide={async (decision) => {
                  const updated = await run('deciding', () => decide(view.id, decision));
                  if (updated) router.push(next ? `/labels/${next.id}` : '/');
                }}
              />
            ) : (
              <DecidedNote view={view} />
            )}
            <section aria-labelledby="fields-heading" className="flex flex-col gap-3">
              <h2 id="fields-heading" className="text-xl font-semibold">
                Label details
              </h2>
              <ReviewerValuesForm
                key={version}
                report={report}
                saving={busy === 'saving'}
                onHighlight={setHighlight}
                onSave={(values) => void run('saving', () => saveReviewerValues(view.id, values))}
              />
            </section>
          </div>
        </div>


      </div>

      <ImageInspector open={zoomOpen} onOpenChange={setZoomOpen} imageUrl={view.imageUrl} alt={`Label photo: ${title}`} />
    </div>
  );
}

const RULE_ICON = { pass: Check, review: AlertTriangle, fail: X } as const;
const RULE_TONE = {
  pass: 'text-status-good',
  review: 'bg-warning/15 text-status-review',
  fail: 'bg-destructive/10 text-status-problem',
} as const;

function RuleItem({ rule, onHighlight }: { rule: RuleOutcome; onHighlight: OnHighlight }) {
  const Icon = RULE_ICON[rule.status];
  return (
    <li
      // Each rule id is the label field it checks.
      {...highlightHandlers(rule.id as CorrectableField, onHighlight)}
      tabIndex={0}
      className={cn(
        'flex gap-3 rounded-lg px-4 py-3 outline-none hover:ring-2 hover:ring-sky-500/60 focus-visible:ring-2 focus-visible:ring-sky-500',
        rule.status !== 'pass' && RULE_TONE[rule.status],
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', RULE_TONE[rule.status])} />
      <div className="flex flex-col gap-0.5 text-foreground">
        <span className="text-base font-semibold">{rule.label}</span>
        <span className="text-base">{rule.reason}</span>
        <span className="text-sm text-muted-foreground">{rule.cfr.section}</span>
      </div>
    </li>
  );
}

function DecidedNote({ view }: { view: LabelView }) {
  const latest = view.decisions[0];
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-base">
      <p className="font-semibold">
        {view.status === 'approved' ? 'Approved' : 'Rejected'}
        {latest?.reviewer ? ` by ${latest.reviewer}` : ''} on {new Date(view.statusAt).toLocaleString()}.
      </p>
      {latest?.reason ? <p className="mt-1">{latest.reason}</p> : null}
    </div>
  );
}

function ReviewQueue({ queue, currentId }: { queue: QueueEntry[]; currentId: string }) {
  return (
    <nav aria-label="Labels to review" className="hidden flex-col gap-3 lg:flex">
      <Link href="/" className="inline-flex items-center gap-1 text-base font-medium underline underline-offset-4">
        <ChevronLeft aria-hidden className="size-4" /> All labels
      </Link>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        To review · {queue.length}
      </p>
      <ul className="flex flex-col gap-1">
        {queue.map((entry) => (
          <li key={entry.id}>
            <Link
              href={`/labels/${entry.id}`}
              aria-current={entry.id === currentId ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg border-2 border-transparent p-2 hover:bg-muted',
                entry.id === currentId && 'border-foreground bg-card',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
              <img src={entry.imageUrl} alt="" className="h-12 w-10 shrink-0 rounded object-cover" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-base font-semibold">{entry.title}</span>
                <VerdictText verdict={entry.verdict} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

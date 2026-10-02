'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { buildChecklist } from '@/lib/labels/checklist';
import { decide, saveReviewerValues } from '@/lib/labels/client-api';
import { type CorrectableField } from '@/lib/labels/corrections';
import { type LabelView } from '@/lib/labels/label-view';
import { labelTitle } from '@/lib/labels/presentation';
import { type Verdict } from '@/lib/labels/verdict';
import { cn } from '@/lib/utils';
import { useBatch } from './batch-provider';
import { DecisionPanel } from './decision-panel';
import { ImageInspector } from './image-inspector';
import { LabelChecklist } from './label-checklist';
import { LabelPhoto } from './label-photo';
import { DecisionChip, VerdictChip, VerdictText } from './status-chip';

export interface QueueEntry {
  id: string;
  title: string;
  verdict: Verdict;
  imageUrl: string;
}

/** One label at a time: the photo, everything checked on it, fixes and application values, and the decision. */
export function ReviewScreen({
  initial,
  queue,
}: {
  initial: LabelView;
  queue: QueueEntry[];
}) {
  const router = useRouter();
  const { replaceLabel } = useBatch();
  const [view, setView] = useState(initial);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<'saving' | 'deciding' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [highlight, setHighlight] = useState<CorrectableField | null>(null);
  const [queueHidden, setQueueHidden, sidebarReady] = useQueueHidden();

  const { report } = view;
  const title = labelTitle(report, view.filename);
  const next = queue.find((entry) => entry.id !== view.id);
  const { legible, issues } = report.effectiveReading.imageQuality;
  const checklist = useMemo(() => buildChecklist(report), [report]);
  const photoTargets = useMemo(
    () =>
      Object.fromEntries(checklist.map((item) => [item.field, item.locate])) as Record<
        CorrectableField,
        string | null
      >,
    [checklist],
  );

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
    <div className="flex w-full">
      <ReviewQueue
        queue={queue}
        currentId={view.id}
        collapsed={queueHidden}
        animate={sidebarReady}
        onToggle={() => setQueueHidden(!queueHidden)}
      />

      <div className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 text-base font-medium underline underline-offset-4 lg:hidden"
          >
            <ChevronLeft aria-hidden className="size-4" /> All labels
          </Link>

          <div
            className={cn(
              'grid gap-6 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none',
              queueHidden
                ? 'xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'
                : 'xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]',
            )}
          >
            <figure className="flex flex-col gap-2 xl:sticky xl:top-24 xl:self-start">
              <LabelPhoto
                imageUrl={view.imageUrl}
                alt={`Label photo: ${title}`}
                targets={photoTargets}
                highlight={highlight}
                large={queueHidden}
                onZoom={() => setZoomOpen(true)}
              />
              <figcaption className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span className="font-mono">
                  {view.filename} · read in {(view.latencyMs / 1000).toFixed(1)} s
                </span>
                <span>Point at an item to see where it is on the label.</span>
              </figcaption>
            </figure>

            <div className="flex min-w-0 flex-col gap-6">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                {view.status === 'to_review' ? (
                  <VerdictChip verdict={report.verdict} />
                ) : (
                  <DecisionChip status={view.status} />
                )}
              </div>

              {!legible || issues.length > 0 ? (
                <div className="flex gap-3 rounded-xl border border-warning/50 bg-warning/15 p-4 text-base">
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 text-status-review"
                  />
                  <div>
                    <p className="font-semibold">
                      {legible
                        ? 'Parts of this photo were hard to read.'
                        : 'This photo is too hard to read reliably.'}
                    </p>
                    <p>
                      {issues.join(' · ') || 'Ask the applicant for a clearer photo.'}
                    </p>
                  </div>
                </div>
              ) : null}

              <section aria-labelledby="details-heading" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <h2 id="details-heading" className="text-xl font-semibold">
                      Label details
                    </h2>
                    <p className="text-lg font-semibold">{attentionSummary(checklist)}</p>
                  </div>
                  {view.status === 'to_review' ? (
                    <DecisionPanel
                      busy={busy !== null}
                      suggestedReason={checklist
                        .flatMap((item) => (item.reason ? [item.reason] : []))
                        .join(' ')}
                      onDecide={async (decision) => {
                        const updated = await run('deciding', () =>
                          decide(view.id, decision),
                        );
                        if (updated) router.push(next ? `/labels/${next.id}` : '/');
                      }}
                    />
                  ) : null}
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-status-problem"
                  >
                    {error}
                  </p>
                ) : null}
                {view.status === 'to_review' ? null : <DecidedNote view={view} />}

                <LabelChecklist
                  key={version}
                  report={report}
                  saving={busy === 'saving'}
                  onHighlight={setHighlight}
                  onSave={(values) =>
                    void run('saving', () => saveReviewerValues(view.id, values))
                  }
                />
                {view.status === 'to_review' ? (
                  <p className="text-sm text-muted-foreground">
                    After you approve or reject, the next label opens.
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </div>

      <ImageInspector
        open={zoomOpen}
        onOpenChange={setZoomOpen}
        imageUrl={view.imageUrl}
        alt={`Label photo: ${title}`}
      />
    </div>
  );
}

function attentionSummary(checklist: ReturnType<typeof buildChecklist>): string {
  const count = checklist.filter(
    (item) => item.status === 'fail' || item.status === 'review',
  ).length;
  if (count === 0) return 'Everything required is on the label.';
  return `${count} ${count === 1 ? 'item needs' : 'items need'} attention.`;
}

const QUEUE_HIDDEN_KEY = 'label-check:queue-hidden';

/**
 * Whether the review list is collapsed, remembered on this device. `ready`
 * turns true a frame after the saved choice is applied, so the sidebar
 * animates when the reviewer toggles it but not on page load.
 */
function useQueueHidden(): [boolean, (hidden: boolean) => void, boolean] {
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(QUEUE_HIDDEN_KEY) === '1');
    } catch {
      // Storage can be unavailable (private windows); the list just starts open.
    }
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return [
    hidden,
    (next) => {
      setHidden(next);
      try {
        window.localStorage.setItem(QUEUE_HIDDEN_KEY, next ? '1' : '0');
      } catch {
        // See above.
      }
    },
    ready,
  ];
}

function DecidedNote({ view }: { view: LabelView }) {
  const latest = view.decisions[0];
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-base">
      <p className="font-semibold">
        {view.status === 'approved' ? 'Approved' : 'Rejected'}
        {latest?.reviewer ? ` by ${latest.reviewer}` : ''} on{' '}
        {new Date(view.statusAt).toLocaleString()}.
      </p>
      {latest?.reason ? <p className="mt-1">{latest.reason}</p> : null}
    </div>
  );
}

function ReviewQueue({
  queue,
  currentId,
  collapsed,
  animate,
  onToggle,
}: {
  queue: QueueEntry[];
  currentId: string;
  collapsed: boolean;
  animate: boolean;
  onToggle(): void;
}) {
  return (
    <aside
      aria-label="Labels to review"
      className={cn(
        // Full height under the header; slides between a list and a narrow rail.
        'sticky top-16 hidden h-[calc(100svh-4rem)] shrink-0 overflow-hidden border-r border-border bg-card lg:block',
        animate &&
          'transition-[width] duration-300 ease-out motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-72',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show the list of labels' : 'Hide the list of labels'}
        title={collapsed ? `Show labels to review (${queue.length})` : 'Hide the list'}
        className="absolute right-2.5 top-3 z-10 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden className="size-5" />
        ) : (
          <PanelLeftClose aria-hidden className="size-5" />
        )}
      </button>

      {/* Fixed width so the list does not reflow while the panel slides. */}
      <div
        inert={collapsed}
        className={cn(
          'flex h-full w-72 flex-col transition-opacity duration-200 motion-reduce:transition-none',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 text-base font-medium underline underline-offset-4"
          >
            <ChevronLeft aria-hidden className="size-4" /> All labels
          </Link>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            To review · {queue.length}
          </p>
        </div>
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {queue.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/labels/${entry.id}`}
                aria-current={entry.id === currentId ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg border-2 border-transparent p-2 hover:bg-muted',
                  entry.id === currentId && 'border-foreground bg-background',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
                <img
                  src={entry.imageUrl}
                  alt=""
                  className="h-12 w-10 shrink-0 rounded object-cover"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-semibold">{entry.title}</span>
                  <VerdictText verdict={entry.verdict} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

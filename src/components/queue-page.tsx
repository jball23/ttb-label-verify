'use client';

import {
  useCallback,
  useState,
  type DragEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import ScenarioPicker from '@/components/scenario-picker';
import DetailPageShell from '@/components/detail-page-shell';
import FinalizeForm from '@/components/finalize-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import { type ResultLine } from '@/lib/results/result-types';
import { type ApplicationSummary } from '@/db/applications';
import { cn } from '@/lib/utils';
import { type QueueData } from '@/app/(app)/page';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const VERIFY_CONCURRENCY = 1;

type Tab = 'queue' | 'approved' | 'rejected' | 'finalized';

interface InFlightItem {
  id: string;
  file: File;
  status: 'queued' | 'processing' | 'failed';
  errorMessage?: string;
}

type FinalDecision = 'approved' | 'rejected';

interface Props {
  initial: QueueData;
  databaseConnected: boolean;
}

export default function QueuePage({ initial, databaseConnected }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('queue');
  const [inFlight, setInFlight] = useState<InFlightItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [activeVerifies, setActiveVerifies] = useState(0);

  const verify = useCallback(
    async (item: InFlightItem) => {
      setInFlight((curr) =>
        curr.map((c) =>
          c.id === item.id ? { ...c, status: 'processing', errorMessage: undefined } : c,
        ),
      );
      try {
        const fd = new FormData();
        fd.append('pdf', item.file, item.file.name);
        const res = await fetch('/api/verify', { method: 'POST', body: fd });
        if (!res.ok || !res.body) {
          const text = res.ok ? 'No response body' : await safeErrorText(res);
          setInFlight((curr) =>
            curr.map((c) =>
              c.id === item.id ? { ...c, status: 'failed', errorMessage: text } : c,
            ),
          );
          return;
        }
        let final: ResultLine | null = null;
        for await (const entry of consumeResultStream(res.body.getReader())) {
          if (entry.kind === 'value') final = entry.value;
        }
        if (!final) {
          setInFlight((curr) =>
            curr.map((c) =>
              c.id === item.id
                ? {
                    ...c,
                    status: 'failed',
                    errorMessage: 'Verify did not return a result. Retry this PDF.',
                  }
                : c,
            ),
          );
          return;
        }
        if (final && final.status === 'error') {
          setInFlight((curr) =>
            curr.map((c) =>
              c.id === item.id
                ? { ...c, status: 'failed', errorMessage: final.errorMessage }
                : c,
            ),
          );
          return;
        }
        // Success — remove from in-flight, refresh server data
        setInFlight((curr) => curr.filter((c) => c.id !== item.id));
        router.refresh();
      } catch (e) {
        setInFlight((curr) =>
          curr.map((c) =>
            c.id === item.id
              ? { ...c, status: 'failed', errorMessage: (e as Error).message }
              : c,
          ),
        );
      }
    },
    [router],
  );

  const enqueue = useCallback(
    (files: File[]) => {
      const accepted: InFlightItem[] = [];
      for (const file of files) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          setStageError(`"${file.name}" isn't a PDF.`);
          continue;
        }
        if (file.size === 0) {
          setStageError(`"${file.name}" is empty.`);
          continue;
        }
        if (file.size > MAX_PDF_BYTES) {
          setStageError(`"${file.name}" exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
          continue;
        }
        accepted.push({
          id: `if_${Math.random().toString(36).slice(2)}_${Date.now()}`,
          file,
          status: 'queued',
        });
      }
      if (accepted.length === 0) return;
      setStageError(null);
      setInFlight((curr) => [...curr, ...accepted]);
      // Switch to Queue tab so the user sees what's processing.
      setActiveTab('queue');
      // Bounded concurrency
      void runConcurrent(accepted, VERIFY_CONCURRENCY, verify, setActiveVerifies);
    },
    [verify],
  );

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) enqueue(files);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) enqueue(files);
    e.target.value = '';
  }

  const counts = {
    queue: inFlight.length,
    approved: initial.counts.approved,
    rejected: initial.counts.rejected,
    finalized: initial.counts.finalized,
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      {stageError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertTitle>Could not stage that file</AlertTitle>
          <AlertDescription>{stageError}</AlertDescription>
        </Alert>
      )}

      <div className="mb-4" role="tablist" aria-label="Triage queue">
        <div className="flex flex-wrap gap-1 border-b border-border">
          <TabButton
            label="Queue"
            count={counts.queue}
            active={activeTab === 'queue'}
            onClick={() => setActiveTab('queue')}
            pulse={activeVerifies > 0}
          />
          <TabButton
            label="Approved"
            count={counts.approved}
            active={activeTab === 'approved'}
            onClick={() => setActiveTab('approved')}
          />
          <TabButton
            label="Rejected"
            count={counts.rejected}
            active={activeTab === 'rejected'}
            onClick={() => setActiveTab('rejected')}
          />
          <TabButton
            label="Finalized"
            count={counts.finalized}
            active={activeTab === 'finalized'}
            onClick={() => setActiveTab('finalized')}
          />
        </div>
      </div>

      {activeTab === 'queue' && (
        <QueueTab
          inFlight={inFlight}
          onRemove={(id) => setInFlight((c) => c.filter((i) => i.id !== id))}
          onRetry={(id) => {
            const item = inFlight.find((i) => i.id === id);
            if (!item) return;
            setInFlight((curr) =>
              curr.map((c) =>
                c.id === id ? { ...c, status: 'processing', errorMessage: undefined } : c,
              ),
            );
            void verify({ ...item, status: 'processing' });
          }}
          onFilesPicked={enqueue}
          isDragging={isDragging}
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          handleFileInput={handleFileInput}
          onScenarioError={setStageError}
        />
      )}

      {activeTab === 'approved' && (
        <DecisionTab
          cards={initial.approvedPending}
          tab="approved"
          databaseConnected={databaseConnected}
        />
      )}

      {activeTab === 'rejected' && (
        <DecisionTab
          cards={initial.rejectedPending}
          tab="rejected"
          databaseConnected={databaseConnected}
        />
      )}

      {activeTab === 'finalized' && (
        <FinalizedTab
          cards={initial.finalized}
          databaseConnected={databaseConnected}
          onArchived={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QueueTab({
  inFlight,
  onRemove,
  onRetry,
  onFilesPicked,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  handleFileInput,
  onScenarioError,
}: {
  inFlight: InFlightItem[];
  onRemove(id: string): void;
  onRetry(id: string): void;
  onFilesPicked(files: File[]): void;
  isDragging: boolean;
  onDragOver(e: DragEvent<HTMLDivElement>): void;
  onDragLeave(e: DragEvent<HTMLDivElement>): void;
  onDrop(e: DragEvent<HTMLDivElement>): void;
  handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void;
  onScenarioError(message: string): void;
}) {
  if (inFlight.length === 0) {
    return (
      <div>
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            PDF OCR · COLA cross-check + TTB rule engine
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Verify TTB COLA applications
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
            Drop one or many filled Form 5100.31 PDFs. The verifier reads each
            application + its affixed label, cross-checks them, and routes the
            result to Approved or Rejected for your final sign-off.
          </p>
        </div>

        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'group relative overflow-hidden rounded-2xl border-2 border-dashed bg-muted/20 transition-all',
            isDragging
              ? 'scale-[1.01] border-foreground bg-[color-mix(in_srgb,var(--foreground)_4%,var(--card))]'
              : 'border-border hover:border-foreground/30 hover:bg-muted/40',
          )}
        >
          <label
            htmlFor="pdf-upload"
            className="flex cursor-pointer flex-col items-center justify-center px-6 py-12 text-center sm:py-16"
          >
            <div
              className={cn(
                'mb-5 flex size-14 items-center justify-center rounded-full border border-border bg-background shadow-xs transition-transform',
                isDragging && 'scale-110',
              )}
            >
              {isDragging ? (
                <Upload className="size-6 text-foreground" />
              ) : (
                <FileText className="size-6 text-muted-foreground" />
              )}
            </div>
            <p className="mb-1.5 text-base font-medium">
              {isDragging ? 'Drop to upload' : 'Drop COLA application PDFs here'}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              or click anywhere in this box to browse
            </p>
            <p className="text-xs text-muted-foreground">
              TTB Form 5100.31 · PDF only · up to {MAX_PDF_BYTES / 1024 / 1024} MB each · drop multiple to batch
            </p>
          </label>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFileInput}
            className="sr-only"
            aria-label="Upload COLA application PDFs"
          />
        </div>

        <div className="mt-6">
          <ScenarioPicker
            onScenariosLoaded={(files) => onFilesPicked(files)}
            onError={onScenarioError}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {inFlight.filter((i) => i.status === 'processing').length} processing ·{' '}
          {inFlight.filter((i) => i.status === 'queued').length} queued ·{' '}
          {inFlight.filter((i) => i.status === 'failed').length} failed
        </p>
        <label
          htmlFor="pdf-add-more"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent/40"
        >
          <Plus className="size-3.5" />
          Add Application(s)
        </label>
        <input
          id="pdf-add-more"
          type="file"
          multiple
          accept="application/pdf,.pdf"
          onChange={handleFileInput}
          className="sr-only"
        />
      </div>

      <ul className="space-y-2">
        {inFlight.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <InFlightIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.file.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {(item.file.size / 1024).toFixed(1)} KB ·{' '}
                {item.status === 'processing'
                  ? 'analyzing…'
                  : item.status === 'queued'
                    ? 'queued'
                    : item.errorMessage ?? 'failed'}
              </p>
            </div>
            {item.status === 'failed' && (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/40"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.file.name}`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InFlightIcon({ status }: { status: InFlightItem['status'] }) {
  if (status === 'processing')
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (status === 'queued') return <FileText className="size-4 text-muted-foreground" />;
  return <AlertCircle className="size-4 text-rose-600" />;
}

// ---------------------------------------------------------------------------

function DecisionTab({
  cards,
  tab,
  databaseConnected,
}: {
  cards: ApplicationSummary[];
  tab: 'approved' | 'rejected';
  databaseConnected: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(
    cards.length === 1 ? cards[0]!.id : null,
  );

  if (!databaseConnected) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Database not configured. Set DATABASE_URL in <code>.env.local</code> and
        run <code>npm run db:push</code>.
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nothing here to finalize.
      </div>
    );
  }

  function toggle(id: string): void {
    setExpandedId((curr) => (curr === id ? null : id));
  }

  return (
    <ul className="space-y-2">
      {cards.map((card) => {
        const expanded = expandedId === card.id;
        return (
          <ReviewCard
            key={card.id}
            card={card}
            decision={tab}
            expanded={expanded}
            onToggle={() => toggle(card.id)}
            statusPill={<AiVerdictPill aiVerdict={card.aiVerdict} />}
          />
        );
      })}
    </ul>
  );
}

function ReviewCard({
  card,
  decision,
  expanded,
  onToggle,
  statusPill,
  archiveSelector,
  selectedForArchive = false,
}: {
  card: ApplicationSummary;
  decision: FinalDecision;
  expanded: boolean;
  onToggle(): void;
  statusPill: React.ReactNode;
  archiveSelector?: React.ReactNode;
  selectedForArchive?: boolean;
}) {
  const finalized = card.currentStatus === 'approved' || card.currentStatus === 'rejected';
  const timestampLabel = finalized
    ? `finalized ${formatRelative(card.currentStatusAt)}`
    : `processed ${card.createdAt.toLocaleString()}`;

  return (
    <li
      className={cn(
        'rounded-xl border bg-card [overflow:clip]',
        selectedForArchive ? 'border-primary/60 bg-primary/5' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30 sm:px-4">
        {archiveSelector}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <DecisionIcon decision={decision} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {card.sourceFilename}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {card.brandName ?? 'unknown brand'} ·{' '}
              {card.ttbSerialNumber ?? 'no serial'} ·{' '}
              {timestampLabel}
            </p>
          </div>
          {statusPill}
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-background p-2 sm:p-3">
          <div className="mx-auto w-full px-2 sm:px-4">
            <DetailPageShell
              report={card.validationReport}
              applicationId={card.id}
              hasStoredPdf={card.hasPdfBytes}
              leftFooter={
                <FinalizeForm
                  applicationId={card.id}
                  aiVerdict={card.aiVerdict}
                  initialDecision={finalized ? decision : undefined}
                  mode={finalized ? 'revise' : 'finalize'}
                />
              }
            />
          </div>
        </div>
      )}
    </li>
  );
}

function DecisionIcon({ decision }: { decision: FinalDecision }) {
  if (decision === 'approved')
    return <Check className="size-4 text-emerald-600" />;
  return <X className="size-4 text-rose-600" />;
}

// ---------------------------------------------------------------------------

function FinalizedTab({
  cards,
  databaseConnected,
  onArchived,
}: {
  cards: ApplicationSummary[];
  databaseConnected: boolean;
  onArchived(): void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(
    cards.length === 1 ? cards[0]!.id : null,
  );
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  if (!databaseConnected) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Database not configured. Set DATABASE_URL in <code>.env.local</code> and
        run <code>npm run db:push</code>.
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nothing finalized yet. Approve or reject a queued application to send
        it here, then batch-archive via the button at the top of the list.
      </div>
    );
  }

  const allSelected = selected.size === cards.length;
  const noneSelected = selected.size === 0;

  function toggleSelection(id: string): void {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(cards.map((c) => c.id)));
  }

  function toggleExpanded(id: string): void {
    setExpandedId((curr) => (curr === id ? null : id));
  }

  async function archiveSelected(): Promise<void> {
    if (noneSelected || isArchiving) return;
    setArchiveError(null);
    setIsArchiving(true);
    try {
      const res = await fetch('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setArchiveError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setSelected(new Set());
      onArchived();
    } catch (e) {
      setArchiveError((e as Error).message);
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 sm:px-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={allSelected}
            // Use indeterminate when some but not all are selected.
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && !noneSelected;
            }}
            onChange={toggleAll}
            aria-label="Select all"
            className="size-3.5"
          />
          <span className="font-medium">
            {noneSelected
              ? 'Select all'
              : allSelected
                ? `All ${cards.length} selected`
                : `${selected.size} of ${cards.length} selected`}
          </span>
        </label>
        <button
          type="button"
          onClick={archiveSelected}
          disabled={noneSelected || isArchiving}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {isArchiving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Archive className="size-3.5" />
          )}
          Archive Selected
        </button>
      </div>

      {archiveError && (
        <Alert variant="destructive" className="mb-3">
          <AlertCircle />
          <AlertTitle>Could not archive</AlertTitle>
          <AlertDescription>{archiveError}</AlertDescription>
        </Alert>
      )}

      <ul className="space-y-2">
        {cards.map((card) => {
          const isOn = selected.has(card.id);
          const decision = finalDecision(card.currentStatus);
          if (!decision) return null;
          const expanded = expandedId === card.id;
          return (
            <ReviewCard
              key={card.id}
              card={card}
              decision={decision}
              expanded={expanded}
              onToggle={() => toggleExpanded(card.id)}
              statusPill={<FinalDecisionPill decision={decision} />}
              selectedForArchive={isOn}
              archiveSelector={
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggleSelection(card.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${card.sourceFilename}`}
                  className="size-3.5 shrink-0"
                />
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

function FinalDecisionPill({
  decision,
}: {
  decision: FinalDecision;
}) {
  if (decision === 'approved') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        Approved
      </span>
    );
  }
  if (decision === 'rejected') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        Rejected
      </span>
    );
  }
  return null;
}

function finalDecision(status: ApplicationSummary['currentStatus']): FinalDecision | null {
  if (status === 'approved' || status === 'rejected') return status;
  return null;
}

function AiVerdictPill({
  aiVerdict,
}: {
  aiVerdict: 'compliant' | 'needs_review' | 'non_compliant';
}) {
  if (aiVerdict === 'compliant') {
    return <Badge>AI: Compliant</Badge>;
  }
  if (aiVerdict === 'non_compliant') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        AI: Non-compliant
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      AI: Needs review
    </span>
  );
}

// ---------------------------------------------------------------------------

function TabButton({
  label,
  count,
  active,
  onClick,
  pulse,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick(): void;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'inline-flex min-w-4 items-center justify-center rounded-full px-1.5 text-[10px]',
          active
            ? 'bg-foreground/10 text-foreground'
            : 'bg-muted text-muted-foreground',
          pulse && 'animate-pulse',
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  setActive: (n: number | ((prev: number) => number)) => void,
): Promise<void> {
  const queue = [...items];
  const runNext = async (): Promise<void> => {
    const next = queue.shift();
    if (!next) return;
    setActive((n) => n + 1);
    try {
      await worker(next);
    } finally {
      setActive((n) => n - 1);
    }
    await runNext();
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const err = (parsed as { error: unknown }).error;
        return typeof err === 'string' ? err : text;
      }
    } catch {
      /* not JSON */
    }
    if (/FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
      return 'Verification timed out on the server. Retry this PDF after the deploy finishes.';
    }
    return text;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Decision = 'approved' | 'rejected';

interface Props {
  applicationId: string;
  // AI's pick — used to pre-select the decision button. compliant and
  // needs_review both pre-select Approve (the verdict tiers are: compliant
  // = obviously fine, needs_review = look at it but probably fine,
  // non_compliant = actually rejected). Only non_compliant pre-selects
  // Reject — that mirrors how persist-verification routes initial status.
  aiVerdict: 'compliant' | 'needs_review' | 'non_compliant';
  defaultReviewerLabel?: string;
  onSubmitted?(decision: Decision): void;
}

const aiPick = (v: Props['aiVerdict']): Decision =>
  v === 'non_compliant' ? 'rejected' : 'approved';

export default function FinalizeForm({
  applicationId,
  aiVerdict,
  defaultReviewerLabel,
  onSubmitted,
}: Props) {
  const router = useRouter();
  // Pre-select the AI's pick. Reviewer can flip it before finalizing.
  const [decision, setDecision] = useState<Decision>(aiPick(aiVerdict));
  const [reviewerLabel, setReviewerLabel] = useState(defaultReviewerLabel ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const requiresReason = decision === 'rejected';
  const submitDisabled =
    isPending || (requiresReason && reason.trim().length === 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch('/api/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId,
          decision,
          reviewerLabel: reviewerLabel.trim() || null,
          decisionReason: reason.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      onSubmitted?.(decision);
      router.refresh();
    });
  }

  const aiPicked = aiPick(aiVerdict);
  const flippedFromAi = decision !== aiPicked;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Finalize</h2>
        <p className="text-[11px] text-muted-foreground">
          The AI&apos;s pick is pre-selected. Keep it or flip it, then Finalize
          to lock the decision in.
        </p>
      </header>
      <form onSubmit={submit} className="space-y-3 px-3 py-3">
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            AI Verdict
          </p>
          {aiVerdict === 'compliant' && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              Compliant · AI suggests Approve
            </span>
          )}
          {aiVerdict === 'needs_review' && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Needs review · AI suggests Approve
            </span>
          )}
          {aiVerdict === 'non_compliant' && (
            <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
              Non-compliant · AI suggests Reject
            </span>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            Decision {flippedFromAi && <span className="text-amber-600 dark:text-amber-400">(flipped from AI)</span>}
          </p>
          <div className="flex gap-2">
            <DecisionButton
              icon={<Check className="size-3.5" />}
              label="Approve"
              tone="emerald"
              active={decision === 'approved'}
              onClick={() => setDecision('approved')}
            />
            <DecisionButton
              icon={<X className="size-3.5" />}
              label="Reject"
              tone="rose"
              active={decision === 'rejected'}
              onClick={() => setDecision('rejected')}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="reviewer-label"
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Reviewer initials (optional)
          </label>
          <input
            id="reviewer-label"
            type="text"
            value={reviewerLabel}
            onChange={(e) => setReviewerLabel(e.target.value)}
            placeholder="e.g. JP"
            maxLength={50}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div>
          <label
            htmlFor="reason"
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Reason {requiresReason && <span className="text-rose-600">*</span>}
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={
              decision === 'approved'
                ? 'Optional notes for the audit trail.'
                : 'Required: explain the rejection.'
            }
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
            decision === 'approved'
              ? 'bg-emerald-500 text-white hover:bg-emerald-500/90'
              : 'bg-rose-500 text-white hover:bg-rose-500/90',
          )}
        >
          {isPending && <Loader2 className="size-3 animate-spin" />}
          Finalize as {decision === 'approved' ? 'Approved' : 'Rejected'}
        </button>
      </form>
    </section>
  );
}

function DecisionButton({
  icon,
  label,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'emerald' | 'rose';
  active: boolean;
  onClick(): void;
}) {
  const toneBase = {
    emerald:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300',
  }[tone];
  const toneActive = {
    emerald:
      'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/40 hover:bg-emerald-500/90',
    rose: 'border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-500/40 hover:bg-rose-500/90',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all',
        active ? toneActive : `${toneBase} opacity-60 hover:opacity-100`,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type LabelDecision } from '@/lib/labels/label-record';
import { cn } from '@/lib/utils';

interface Props {
  busy: boolean;
  onDecide(decision: { decision: LabelDecision; reason: string | null; reviewer: string | null }): void;
  /** Pre-fills the reason box when rejecting, from the problems found. */
  suggestedReason: string;
}

const REVIEWER_KEY = 'label-check:reviewer';

/** Approve or reject. Rejecting asks why; the reviewer's initials are remembered on this device. */
export function DecisionPanel({ busy, onDecide, suggestedReason }: Props) {
  const reasonId = useId();
  const reviewerId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reviewer, setReviewer] = useReviewerName();

  function decide(decision: LabelDecision) {
    onDecide({ decision, reason: decision === 'rejected' ? reason.trim() || null : null, reviewer: reviewer.trim() || null });
  }

  // One field, shown beside whichever buttons are on screen.
  const initials = (
    <>
      <label htmlFor={reviewerId} className="sr-only">
        Your initials (optional)
      </label>
      <Input
        id={reviewerId}
        value={reviewer}
        onChange={(event) => setReviewer(event.target.value)}
        placeholder="Initials"
        title="Your initials (optional)"
        maxLength={20}
        className="h-12 w-28 text-base"
      />
    </>
  );

  return (
    <section
      aria-label="Decision"
      // While rejecting, the panel takes the full row so the reason box has room.
      className={cn('flex flex-col gap-3', rejecting ? 'basis-full' : 'w-full sm:w-auto')}
    >
      {rejecting ? null : (
        <div className="flex flex-wrap items-center gap-3">
          {initials}
          <Button
            size="lg"
            variant="destructive"
            className="h-12 flex-1 px-8 text-lg sm:flex-none"
            disabled={busy}
            onClick={() => {
              setReason(suggestedReason);
              setRejecting(true);
            }}
          >
            Reject
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 flex-1 border-2 border-status-good px-8 text-lg text-status-good hover:bg-success/10 sm:flex-none"
            disabled={busy}
            onClick={() => decide('approved')}
          >
            Approve
          </Button>
        </div>
      )}

      {rejecting ? (
        <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <label htmlFor={reasonId} className="text-base font-semibold">
            Why is this label being rejected?
          </label>
          <textarea
            id={reasonId}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-3">
            {initials}
            <Button size="lg" variant="destructive" className="h-12 px-8 text-lg" disabled={busy || !reason.trim()} onClick={() => decide('rejected')}>
              Reject label
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-lg" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function useReviewerName(): [string, (name: string) => void] {
  const [name, setName] = useState('');
  useEffect(() => {
    try {
      setName(window.localStorage.getItem(REVIEWER_KEY) ?? '');
    } catch {
      // Storage can be unavailable (private windows); initials are optional.
    }
  }, []);
  return [
    name,
    (next) => {
      setName(next);
      try {
        window.localStorage.setItem(REVIEWER_KEY, next);
      } catch {
        // See above.
      }
    },
  ];
}

'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type LabelDecision } from '@/lib/labels/label-record';

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

  return (
    <section aria-label="Decision" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={reviewerId} className="text-sm font-medium text-muted-foreground">
          Your initials (optional)
        </label>
        <Input id={reviewerId} value={reviewer} onChange={(event) => setReviewer(event.target.value)} className="h-11 max-w-40 text-base" maxLength={20} />
      </div>

      {rejecting ? (
        <div className="flex flex-col gap-2">
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
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="destructive" className="h-14 text-lg" disabled={busy || !reason.trim()} onClick={() => decide('rejected')}>
              Reject label
            </Button>
            <Button size="lg" variant="outline" className="h-14 text-lg" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="destructive"
            className="h-14 text-lg"
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
            className="h-14 border-2 border-status-good text-lg text-status-good hover:bg-success/10"
            disabled={busy}
            onClick={() => decide('approved')}
          >
            Approve
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">After you decide, the next label opens.</p>
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

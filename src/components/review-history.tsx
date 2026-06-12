import { Check, X, HelpCircle } from 'lucide-react';
import type { ReviewRow } from '@/db/schema';
import { cn } from '@/lib/utils';

interface Props {
  reviews: ReviewRow[];
}

export default function ReviewHistory({ reviews }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Review history</h2>
        <p className="text-[11px] text-muted-foreground">
          Every human decision on this application, newest first.
        </p>
      </header>
      {reviews.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No reviews yet — the application is awaiting human triage.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {reviews.map((r) => (
            <li key={r.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <DecisionIcon decision={r.decision} />
                <span className="text-xs font-medium">{decisionLabel(r.decision)}</span>
                {r.reviewerLabel && (
                  <span className="text-[11px] text-muted-foreground">
                    by {r.reviewerLabel}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {r.createdAt.toLocaleString()}
                </span>
              </div>
              {r.decisionReason && (
                <p className="mt-1 pl-5 text-[11px] text-foreground/80">{r.decisionReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function decisionLabel(d: string): string {
  switch (d) {
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'needs_more_info': return 'Needs more info';
    default: return d;
  }
}

function DecisionIcon({ decision }: { decision: string }) {
  if (decision === 'approved') return <Check className={cn('size-3.5 text-emerald-600')} />;
  if (decision === 'rejected') return <X className="size-3.5 text-rose-600" />;
  return <HelpCircle className="size-3.5 text-amber-600 dark:text-amber-400" />;
}

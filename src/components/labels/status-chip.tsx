import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { type LabelStatus } from '@/lib/labels/label-record';
import { VERDICT_LABELS, type Verdict } from '@/lib/labels/verdict';
import { cn } from '@/lib/utils';

const CHIP =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold';

const VERDICT_TONE: Record<
  Verdict,
  { background: string; text: string; Icon: typeof Check }
> = {
  problems_found: {
    background: 'bg-destructive/12',
    text: 'text-status-problem',
    Icon: X,
  },
  needs_review: {
    background: 'bg-warning/25',
    text: 'text-status-review',
    Icon: AlertTriangle,
  },
  looks_good: { background: 'bg-success/15', text: 'text-status-good', Icon: Check },
};

/** The tool's suggestion for a label, in words and an icon (never colour alone). */
export function VerdictChip({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  const { background, text, Icon } = VERDICT_TONE[verdict];
  return (
    <span className={cn(CHIP, background, text, className)}>
      <Icon aria-hidden className="size-4" />
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

/** The verdict as coloured words, for tight spaces like the review queue. */
export function VerdictText({ verdict }: { verdict: Verdict }) {
  return (
    <span className={cn('text-sm font-medium', VERDICT_TONE[verdict].text)}>
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

export function CheckingChip({ queued = false }: { queued?: boolean }) {
  return (
    <span className={cn(CHIP, 'bg-muted text-muted-foreground')}>
      {queued ? null : (
        <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      )}
      {queued ? 'Waiting' : 'Checking'}
    </span>
  );
}

const DECISION_STYLE: Record<
  Exclude<LabelStatus, 'to_review'>,
  { label: string; className: string }
> = {
  approved: { label: 'Approved', className: 'bg-success/15 text-status-good' },
  rejected: { label: 'Rejected', className: 'bg-destructive/12 text-status-problem' },
};

export function DecisionChip({ status }: { status: LabelStatus }) {
  if (status === 'to_review') return null;
  const { label, className } = DECISION_STYLE[status];
  return <span className={cn(CHIP, className)}>{label}</span>;
}

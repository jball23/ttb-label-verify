'use client';

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  X,
  FileText,
  Clock,
} from 'lucide-react';
import { type UploadCard } from '@/lib/upload/phase-reducer';
import { Badge } from '@/components/ui/badge';
import VerifierPane from './verifier-pane';
import { cn } from '@/lib/utils';

interface Props {
  cards: UploadCard[];
  onRemove(id: string): void;
}

export default function BatchList({ cards, onRemove }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(
    cards.length === 1 ? cards[0]!.id : null,
  );

  function toggle(id: string): void {
    setExpandedId((curr) => (curr === id ? null : id));
  }

  return (
    <ul className="space-y-2">
      {cards.map((card) => {
        const expanded = expandedId === card.id;
        const expandable = card.status === 'done' || card.status === 'error';
        return (
          <li
            key={card.id}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors sm:px-4',
                expandable && 'hover:bg-accent/30',
              )}
            >
              <button
                type="button"
                onClick={() => expandable && toggle(card.id)}
                disabled={!expandable}
                aria-expanded={expanded}
                aria-label={
                  expandable
                    ? `${expanded ? 'Collapse' : 'Expand'} ${card.file.name}`
                    : undefined
                }
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-3 text-left',
                  expandable
                    ? 'cursor-pointer'
                    : 'cursor-default',
                )}
              >
                <StatusIcon card={card} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{card.file.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {(card.file.size / 1024).toFixed(1)} KB · {humanStatus(card)}
                  </p>
                </div>
                <VerdictBadge card={card} />
                {expandable &&
                  (expanded ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ))}
              </button>
              <button
                type="button"
                onClick={() => onRemove(card.id)}
                aria-label={`Remove ${card.file.name}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {expanded && expandable && (
              <div className="border-t border-border bg-background p-2 sm:p-3">
                <VerifierPane
                  pdfFile={card.file}
                  result={card.result}
                  isStreaming={false}
                  onStartOver={() => onRemove(card.id)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusIcon({ card }: { card: UploadCard }) {
  if (card.status === 'pending')
    return <FileText className="size-4 text-muted-foreground" />;
  if (card.status === 'processing')
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (card.status === 'done')
    return <Check className="size-4 text-emerald-600" />;
  return <AlertTriangle className="size-4 text-rose-600" />;
}

function VerdictBadge({ card }: { card: UploadCard }) {
  if (card.status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
        <Clock className="size-3" />
        pending
      </span>
    );
  if (card.status === 'processing')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        processing
      </span>
    );
  if (card.status === 'error')
    return <Badge variant="destructive">Error</Badge>;
  // done — render verdict
  const verdict =
    card.result && card.result.status === 'ok'
      ? card.result.report.overallStatus
      : null;
  if (verdict === 'compliant') return <Badge>Compliant</Badge>;
  if (verdict === 'needs_review') return <Badge variant="destructive">Needs review</Badge>;
  return <Badge variant="secondary">Done</Badge>;
}

function humanStatus(card: UploadCard): string {
  if (card.status === 'pending') return 'queued';
  if (card.status === 'processing') return 'verifying…';
  if (card.status === 'error') return card.errorMessage ?? 'error';
  return 'ready to review';
}

'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { decidedLabelsCsv } from '@/lib/labels/decided-csv';
import { type LabelView } from '@/lib/labels/label-view';
import { labelTitle } from '@/lib/labels/presentation';
import { LabelRow } from './label-row';
import { DecisionChip } from './status-chip';

/** Labels a person has approved or rejected, newest first, with a spreadsheet export. */
export function DecidedList({ labels }: { labels: LabelView[] }) {
  function exportCsv() {
    const blob = new Blob([decidedLabelsCsv(labels)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `label-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Decided</h1>
          <p className="text-lg text-muted-foreground">Labels that have been approved or rejected.</p>
        </div>
        {labels.length > 0 ? (
          <Button size="lg" variant="outline" className="text-base" onClick={exportCsv}>
            <Download aria-hidden /> Export to spreadsheet
          </Button>
        ) : null}
      </div>

      {labels.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-6 py-10 text-center text-lg text-muted-foreground">
          No labels have been decided yet.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {labels.map((view) => {
            const latest = view.decisions[0];
            const decided = `Decided${latest?.reviewer ? ` by ${latest.reviewer}` : ''} on ${new Date(view.statusAt).toLocaleDateString()}`;
            return (
              <LabelRow
                key={view.id}
                title={labelTitle(view.report, view.filename)}
                detail={latest?.reason ? `${latest.reason} · ${decided}` : decided}
                thumbnailUrl={view.imageUrl}
                chip={<DecisionChip status={view.status} />}
                href={`/labels/${view.id}`}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

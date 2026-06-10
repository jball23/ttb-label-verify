'use client';

import { Download, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { countByStatus } from '@/lib/results/aggregate';
import { formatJSON } from '@/lib/export/json-formatter';
import { formatCSV } from '@/lib/export/csv-formatter';
import { type ResultLine } from '@/lib/results/result-types';

interface Props {
  results: ResultLine[];
  totalExpected: number;
  isStreaming: boolean;
  onStartOver(): void;
}

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SummaryBar({
  results,
  totalExpected,
  isStreaming,
  onStartOver,
}: Props) {
  const counts = countByStatus(results);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const progress = totalExpected > 0 ? (results.length / totalExpected) * 100 : 0;

  return (
    <div className="sticky top-14 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}
              <span className="text-sm font-medium tabular-nums">
                <span className="text-foreground">{results.length}</span>
                <span className="text-muted-foreground"> / {totalExpected}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {isStreaming ? 'checking' : 'checked'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {counts.compliant > 0 && (
                <Badge variant="success" className="tabular-nums">
                  {counts.compliant} compliant
                </Badge>
              )}
              {counts.needsReview > 0 && (
                <Badge variant="warning" className="tabular-nums">
                  {counts.needsReview} need review
                </Badge>
              )}
              {counts.error > 0 && (
                <Badge variant="destructive" className="tabular-nums">
                  {counts.error} error{counts.error === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={results.length === 0 || isStreaming}
              onClick={() =>
                downloadBlob(
                  formatJSON(results),
                  `ttb-results-${ts}.json`,
                  'application/json',
                )
              }
            >
              <Download className="size-3.5" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={results.length === 0 || isStreaming}
              onClick={() =>
                downloadBlob(formatCSV(results), `ttb-results-${ts}.csv`, 'text/csv')
              }
            >
              <Download className="size-3.5" />
              CSV
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={onStartOver}>
              <RotateCcw className="size-3.5" />
              Start over
            </Button>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-foreground transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

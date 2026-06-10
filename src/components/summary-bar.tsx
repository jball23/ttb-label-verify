'use client';

import { Button, ButtonGroup } from '@trussworks/react-uswds';
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

  return (
    <div className="summary-bar margin-bottom-3">
      <div className="grid-container">
        <div className="display-flex flex-wrap flex-align-center flex-justify">
          <div className="display-flex flex-align-center">
            <span className="font-sans-md margin-right-3">
              <strong>{results.length}</strong> of <strong>{totalExpected}</strong> checked
            </span>
            {counts.compliant > 0 && (
              <span className="margin-right-2 padding-x-1 padding-y-05 radius-pill bg-success-lighter text-success-darker font-sans-2xs">
                {counts.compliant} compliant
              </span>
            )}
            {counts.needsReview > 0 && (
              <span className="margin-right-2 padding-x-1 padding-y-05 radius-pill bg-warning-lighter text-warning-darker font-sans-2xs">
                {counts.needsReview} need review
              </span>
            )}
            {counts.error > 0 && (
              <span className="margin-right-2 padding-x-1 padding-y-05 radius-pill bg-error-lighter text-error-darker font-sans-2xs">
                {counts.error} error{counts.error === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <ButtonGroup>
            <Button
              type="button"
              outline
              disabled={results.length === 0 || isStreaming}
              onClick={() =>
                downloadBlob(
                  formatJSON(results),
                  `ttb-results-${ts}.json`,
                  'application/json',
                )
              }
            >
              Download JSON
            </Button>
            <Button
              type="button"
              outline
              disabled={results.length === 0 || isStreaming}
              onClick={() =>
                downloadBlob(formatCSV(results), `ttb-results-${ts}.csv`, 'text/csv')
              }
            >
              Download CSV
            </Button>
            <Button type="button" secondary onClick={onStartOver}>
              Start over
            </Button>
          </ButtonGroup>
        </div>
      </div>
    </div>
  );
}

'use client';

import { liveRegionMessage } from '@/lib/results/aggregate';
import { type ResultLine } from '@/lib/results/result-types';
import ResultCard from './result-card';
import SummaryBar from './summary-bar';

interface Props {
  files: File[];
  results: ResultLine[];
  totalExpected: number;
  isStreaming: boolean;
  onStartOver(): void;
}

export default function ResultsGrid({
  files,
  results,
  totalExpected,
  isStreaming,
  onStartOver,
}: Props) {
  // Build an index→result map so cards render in original staged order
  // regardless of arrival order from the server.
  const resultsByIndex = new Map<number, ResultLine>();
  results.forEach((r) => resultsByIndex.set(r.index, r));

  return (
    <>
      <SummaryBar
        results={results}
        totalExpected={totalExpected}
        isStreaming={isStreaming}
        onStartOver={onStartOver}
      />
      <div className="grid-container padding-bottom-6">
        <div
          aria-live="polite"
          aria-atomic="true"
          className="usa-sr-only"
          role="status"
        >
          {liveRegionMessage(results.length, totalExpected)}
        </div>
        <div className="grid-row grid-gap">
          {files.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className="grid-col-12 desktop:grid-col-6">
              <ResultCard file={file} result={resultsByIndex.get(idx)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

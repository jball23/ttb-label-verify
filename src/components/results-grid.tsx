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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
          {liveRegionMessage(results.length, totalExpected)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((file, idx) => (
            <ResultCard
              key={`${file.name}-${idx}`}
              file={file}
              result={resultsByIndex.get(idx)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

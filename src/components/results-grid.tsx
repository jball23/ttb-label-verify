'use client';

import { useEffect, useRef } from 'react';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import { liveRegionMessage } from '@/lib/results/aggregate';
import { type ResultLine } from '@/lib/results/result-types';
import { type Action } from '@/lib/upload/phase-reducer';
import ResultCard from './result-card';
import SummaryBar from './summary-bar';

interface Props {
  files: File[];
  results: ResultLine[];
  totalExpected: number;
  isStreaming: boolean;
  onResult(action: Action): void;
  onStartOver(): void;
}

export default function ResultsGrid({
  files,
  results,
  totalExpected,
  isStreaming,
  onResult,
  onStartOver,
}: Props) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isStreaming || startedRef.current) return;
    startedRef.current = true;

    const ac = new AbortController();
    (async () => {
      try {
        const fd = new FormData();
        files.forEach((f, i) => fd.append(`file-${i}`, f, f.name));
        const res = await fetch('/api/verify', {
          method: 'POST',
          body: fd,
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          // Treat HTTP failure as a per-batch error line for every file.
          const errorText = res.ok ? 'No response body' : await res.text();
          files.forEach((f, i) => {
            onResult({
              type: 'RESULT_RECEIVED',
              result: {
                status: 'error',
                index: i,
                filename: f.name,
                durationMs: 0,
                errorMessage: errorText,
              },
            });
          });
          onResult({ type: 'STREAM_CLOSED' });
          return;
        }
        const reader = res.body.getReader();
        for await (const entry of consumeResultStream(reader)) {
          if (entry.kind === 'value') {
            onResult({ type: 'RESULT_RECEIVED', result: entry.value });
          }
          // parse-error / schema-error entries are dropped silently — the
          // user-visible impact is that one card stays in pending state.
          // We log to console so devs see the contract drift.
          else {
            console.warn('[results-grid] dropped malformed result line', entry);
          }
        }
        onResult({ type: 'STREAM_CLOSED' });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        files.forEach((f, i) => {
          onResult({
            type: 'RESULT_RECEIVED',
            result: {
              status: 'error',
              index: i,
              filename: f.name,
              durationMs: 0,
              errorMessage: `Network error: ${(e as Error).message}`,
            },
          });
        });
        onResult({ type: 'STREAM_CLOSED' });
      }
    })();

    return () => ac.abort();
  }, [isStreaming, files, onResult]);

  // Build a map from filename to its result, so the order of <ResultCard>
  // follows the original staged order regardless of which finished first.
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

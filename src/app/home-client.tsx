'use client';

import { useReducer, useCallback, useRef, useState } from 'react';
import {
  phaseReducer,
  INITIAL_STATE,
} from '@/lib/upload/phase-reducer';
import { validateBatch } from '@/lib/upload/file-validation';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import UploadZone from '@/components/upload-zone';
import StagedFilesList from '@/components/staged-files-list';
import ResultsGrid from '@/components/results-grid';
import { Alert } from '@trussworks/react-uswds';

export default function HomeClient() {
  const [state, dispatch] = useReducer(phaseReducer, INITIAL_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [perFileErrors, setPerFileErrors] = useState<string[]>([]);
  // Tracks the in-flight verify request so Start Over can cancel it.
  const inFlightRef = useRef<AbortController | null>(null);

  const stageFiles = useCallback((incoming: File[]) => {
    const result = validateBatch([...state.files, ...incoming]);
    if (!result.ok) {
      setValidationError(result.reason ?? 'Could not stage files.');
      setPerFileErrors([]);
      return;
    }
    setValidationError(null);
    setPerFileErrors(result.rejected.map((r) => `${r.file.name}: ${r.reason}`));
    const newFiles = result.files.filter((f) => !state.files.includes(f));
    dispatch({ type: 'FILES_STAGED', files: newFiles });
  }, [state.files]);

  const removeFile = useCallback((file: File) => {
    dispatch({ type: 'FILE_REMOVED', file });
  }, []);

  const onVerify = useCallback(async () => {
    if (inFlightRef.current) return; // dedupe rapid double-clicks
    const files = state.files;
    if (files.length === 0) return;

    dispatch({ type: 'VERIFY_STARTED' });

    const ac = new AbortController();
    inFlightRef.current = ac;

    try {
      const fd = new FormData();
      files.forEach((f, i) => fd.append(`file-${i}`, f, f.name));
      const res = await fetch('/api/verify', {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const errorText = res.ok ? 'No response body' : await res.text();
        files.forEach((f, i) => {
          dispatch({
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
      } else {
        for await (const entry of consumeResultStream(res.body.getReader())) {
          if (entry.kind === 'value') {
            dispatch({ type: 'RESULT_RECEIVED', result: entry.value });
          } else {
            console.warn('[home-client] dropped malformed result line', entry);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        files.forEach((f, i) => {
          dispatch({
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
      }
    } finally {
      inFlightRef.current = null;
      dispatch({ type: 'STREAM_CLOSED' });
    }
  }, [state.files]);

  const startOver = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setValidationError(null);
    setPerFileErrors([]);
    dispatch({ type: 'START_OVER' });
  }, []);

  async function loadSample(): Promise<void> {
    try {
      const res = await fetch('/samples/compliant-bourbon.jpg');
      if (!res.ok) {
        setValidationError(
          'Sample label is not available. Add an image at public/samples/compliant-bourbon.jpg.',
        );
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], 'sample-compliant-bourbon.jpg', {
        type: 'image/jpeg',
      });
      stageFiles([file]);
    } catch (e) {
      setValidationError(`Could not load sample: ${(e as Error).message}`);
    }
  }

  return (
    <>
      {(validationError || perFileErrors.length > 0) && (
        <div className="grid-container padding-top-3">
          <div className="grid-row">
            <div className="grid-col-12 desktop:grid-col-8 desktop:grid-offset-2">
              {validationError && (
                <Alert
                  type="error"
                  headingLevel="h3"
                  slim
                  className="margin-bottom-2"
                >
                  {validationError}
                </Alert>
              )}
              {perFileErrors.length > 0 && (
                <Alert
                  type="warning"
                  headingLevel="h3"
                  slim
                  className="margin-bottom-2"
                >
                  Some files were skipped:
                  <ul className="margin-top-1 margin-bottom-0">
                    {perFileErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          </div>
        </div>
      )}

      {state.phase === 'empty' && (
        <UploadZone onFilesSelected={stageFiles} onSampleSelected={loadSample} />
      )}

      {state.phase === 'staged' && (
        <StagedFilesList
          files={state.files}
          onRemove={removeFile}
          onVerify={onVerify}
          onAddMore={stageFiles}
        />
      )}

      {(state.phase === 'processing' || state.phase === 'done') && (
        <ResultsGrid
          files={state.files}
          results={state.results}
          totalExpected={state.totalExpected}
          isStreaming={state.phase === 'processing'}
          onStartOver={startOver}
        />
      )}
    </>
  );
}

'use client';

import { useReducer, useCallback, useRef, useState } from 'react';
import { phaseReducer, INITIAL_STATE } from '@/lib/upload/phase-reducer';
import { validateBatch } from '@/lib/upload/file-validation';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import UploadZone from '@/components/upload-zone';
import StagedFilesList from '@/components/staged-files-list';
import ResultsGrid from '@/components/results-grid';
import ScenarioPicker from '@/components/scenario-picker';
import type { Application } from '@/lib/application/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function HomeClient() {
  const [state, dispatch] = useReducer(phaseReducer, INITIAL_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [perFileErrors, setPerFileErrors] = useState<string[]>([]);
  const inFlightRef = useRef<AbortController | null>(null);

  const stageFiles = useCallback(
    (incoming: File[]) => {
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
    },
    [state.files],
  );

  const removeFile = useCallback((file: File) => {
    dispatch({ type: 'FILE_REMOVED', file });
  }, []);

  const onScenarioLoaded = useCallback(
    (application: Application, file: File) => {
      setValidationError(null);
      setPerFileErrors([]);
      dispatch({ type: 'SCENARIO_LOADED', application, file });
    },
    [],
  );

  const onScenarioError = useCallback((message: string) => {
    setValidationError(message);
  }, []);

  const onVerify = useCallback(async () => {
    if (inFlightRef.current) return;
    const files = state.files;
    if (files.length === 0) return;
    if (!state.application) {
      setValidationError(
        'Pick a demo scenario before verifying. Manual uploads need a COLA application JSON to cross-check against.',
      );
      return;
    }
    if (files.length > 1) {
      setValidationError(
        'Single-label submissions only. Remove the extra labels or pick a different scenario.',
      );
      return;
    }

    dispatch({ type: 'VERIFY_STARTED' });

    const ac = new AbortController();
    inFlightRef.current = ac;

    try {
      const fd = new FormData();
      fd.append('application', JSON.stringify(state.application));
      files.forEach((f, i) => fd.append(`file-${i}`, f, f.name));
      const res = await fetch('/api/verify', {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const errorText = res.ok
          ? 'No response body'
          : await safeErrorText(res);
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
  }, [state.files, state.application]);

  const startOver = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setValidationError(null);
    setPerFileErrors([]);
    dispatch({ type: 'START_OVER' });
  }, []);

  return (
    <>
      {(validationError || perFileErrors.length > 0) && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 space-y-3">
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Cannot stage files</AlertTitle>
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}
          {perFileErrors.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Some files were skipped</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {perFileErrors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {state.phase === 'empty' && (
        <UploadZone
          onFilesSelected={stageFiles}
          scenarioPicker={
            <ScenarioPicker
              onScenarioLoaded={onScenarioLoaded}
              onError={onScenarioError}
            />
          }
        />
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

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const err = (parsed as { error: unknown }).error;
        return typeof err === 'string' ? err : text;
      }
    } catch {
      // not JSON; return raw text
    }
    return text;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

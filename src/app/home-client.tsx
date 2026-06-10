'use client';

import { useReducer, useCallback, useRef, useState, type DragEvent } from 'react';
import { phaseReducer, INITIAL_STATE } from '@/lib/upload/phase-reducer';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import { AlertCircle, FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import ScenarioPicker from '@/components/scenario-picker';
import VerifierPane from '@/components/verifier-pane';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

const MAX_PDF_BYTES = 25 * 1024 * 1024;

export default function HomeClient() {
  const [state, dispatch] = useReducer(phaseReducer, INITIAL_STATE);
  const [stageError, setStageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inFlightRef = useRef<AbortController | null>(null);

  const stagePdf = useCallback((file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setStageError('Only PDF files are accepted. Drop a filled COLA application PDF.');
      return;
    }
    if (file.size === 0) {
      setStageError('That PDF is empty.');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStageError(`PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB limit.`);
      return;
    }
    setStageError(null);
    dispatch({ type: 'PDF_STAGED', file });
  }, []);

  const onScenarioLoaded = useCallback((file: File) => {
    setStageError(null);
    dispatch({ type: 'SCENARIO_LOADED_PDF', file });
  }, []);

  const onScenarioError = useCallback((message: string) => {
    setStageError(message);
  }, []);

  const onVerify = useCallback(async () => {
    if (inFlightRef.current) return;
    const file = state.pdfFile;
    if (!file) return;

    dispatch({ type: 'VERIFY_STARTED' });

    const ac = new AbortController();
    inFlightRef.current = ac;

    try {
      const fd = new FormData();
      fd.append('pdf', file, file.name);
      const res = await fetch('/api/verify', {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const errorText = res.ok ? 'No response body' : await safeErrorText(res);
        dispatch({ type: 'VERIFY_FAILED', message: errorText });
        return;
      }
      for await (const entry of consumeResultStream(res.body.getReader())) {
        if (entry.kind === 'value') {
          dispatch({ type: 'RESULT_RECEIVED', result: entry.value });
        } else {
          console.warn('[home-client] dropped malformed result line', entry);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        dispatch({
          type: 'VERIFY_FAILED',
          message: `Network error: ${(e as Error).message}`,
        });
      }
    } finally {
      inFlightRef.current = null;
      dispatch({ type: 'STREAM_CLOSED' });
    }
  }, [state.pdfFile]);

  const startOver = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setStageError(null);
    dispatch({ type: 'START_OVER' });
  }, []);

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) stagePdf(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) stagePdf(file);
    e.target.value = '';
  }

  if (state.phase === 'empty') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8 text-center sm:mb-12">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            GPT-4o vision · COLA cross-check + TTB rule engine
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Verify a TTB COLA application
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
            Upload the filled Form 5100.31 PDF. The verifier reads the application
            and the affixed label in one pass, cross-checks them, and shows you
            where every value came from on the source document.
          </p>
        </div>

        {stageError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle />
            <AlertTitle>Could not stage that file</AlertTitle>
            <AlertDescription>{stageError}</AlertDescription>
          </Alert>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            'group relative overflow-hidden rounded-2xl border-2 border-dashed bg-muted/20 transition-all',
            isDragging
              ? 'scale-[1.01] border-foreground bg-[color-mix(in_srgb,var(--foreground)_4%,var(--card))]'
              : 'border-border hover:border-foreground/30 hover:bg-muted/40',
          )}
        >
          <label
            htmlFor="pdf-upload"
            className="flex cursor-pointer flex-col items-center justify-center px-6 py-12 text-center sm:py-16"
          >
            <div
              className={cn(
                'mb-5 flex size-14 items-center justify-center rounded-full border border-border bg-background shadow-xs transition-transform',
                isDragging && 'scale-110',
              )}
            >
              {isDragging ? (
                <Upload className="size-6 text-foreground" />
              ) : (
                <FileText className="size-6 text-muted-foreground" />
              )}
            </div>
            <p className="mb-1.5 text-base font-medium">
              {isDragging ? 'Drop to upload' : 'Drop a COLA application PDF here'}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              or click anywhere in this box to browse
            </p>
            <p className="text-xs text-muted-foreground">
              TTB Form 5100.31 · PDF only · up to {MAX_PDF_BYTES / 1024 / 1024} MB
            </p>
          </label>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileInput}
            className="sr-only"
            aria-label="Upload a COLA application PDF"
          />
        </div>

        <div className="mt-6">
          <ScenarioPicker
            onScenarioLoaded={onScenarioLoaded}
            onError={onScenarioError}
          />
        </div>
      </div>
    );
  }

  if (state.phase === 'staged' && state.pdfFile) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-xs">
          <FileText className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-base font-medium">{state.pdfFile.name}</p>
          <p className="mb-6 text-xs text-muted-foreground">
            {(state.pdfFile.size / 1024).toFixed(1)} KB · ready to verify
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={startOver}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/40"
            >
              Pick a different file
            </button>
            <button
              type="button"
              onClick={onVerify}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:bg-foreground/90"
            >
              Verify
            </button>
          </div>
        </div>
      </div>
    );
  }

  if ((state.phase === 'processing' || state.phase === 'done') && state.pdfFile) {
    return (
      <VerifierPane
        pdfFile={state.pdfFile}
        result={state.result}
        isStreaming={state.phase === 'processing'}
        onStartOver={startOver}
      />
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Verification failed</AlertTitle>
          <AlertDescription>
            {state.errorMessage ?? 'An unexpected error occurred.'}
          </AlertDescription>
        </Alert>
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={startOver}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent/40"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 text-center">
      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
    </div>
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
      /* not JSON; return raw text */
    }
    return text;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

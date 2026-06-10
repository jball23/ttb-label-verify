'use client';

import {
  useReducer,
  useCallback,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  phaseReducer,
  INITIAL_STATE,
  type UploadCard,
} from '@/lib/upload/phase-reducer';
import { consumeResultStream } from '@/lib/results/stream-consumer';
import { AlertCircle, FileText, Sparkles, Upload } from 'lucide-react';
import ScenarioPicker from '@/components/scenario-picker';
import BatchList from '@/components/batch-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const VERIFY_CONCURRENCY = 3;

export default function HomeClient() {
  const [state, dispatch] = useReducer(phaseReducer, INITIAL_STATE);
  const [stageError, setStageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  const stageFiles = useCallback((files: File[]) => {
    const accepted: File[] = [];
    for (const file of files) {
      if (
        file.type !== 'application/pdf' &&
        !file.name.toLowerCase().endsWith('.pdf')
      ) {
        setStageError(`"${file.name}" isn't a PDF.`);
        continue;
      }
      if (file.size === 0) {
        setStageError(`"${file.name}" is empty.`);
        continue;
      }
      if (file.size > MAX_PDF_BYTES) {
        setStageError(`"${file.name}" exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    setStageError(null);
    dispatch({ type: 'FILES_ADDED', files: accepted });
  }, []);

  const onScenarioLoaded = useCallback(
    (file: File) => {
      setStageError(null);
      dispatch({ type: 'FILES_ADDED', files: [file] });
    },
    [],
  );

  const onScenarioError = useCallback((message: string) => {
    setStageError(message);
  }, []);

  const verifyCard = useCallback(async (card: UploadCard) => {
    if (inFlightRef.current.has(card.id)) return;
    inFlightRef.current.add(card.id);
    dispatch({ type: 'CARD_VERIFY_STARTED', id: card.id });
    try {
      const fd = new FormData();
      fd.append('pdf', card.file, card.file.name);
      const res = await fetch('/api/verify', { method: 'POST', body: fd });
      if (!res.ok || !res.body) {
        const errText = res.ok ? 'No response body' : await safeErrorText(res);
        dispatch({ type: 'CARD_VERIFY_FAILED', id: card.id, message: errText });
        return;
      }
      for await (const entry of consumeResultStream(res.body.getReader())) {
        if (entry.kind === 'value') {
          dispatch({
            type: 'CARD_RESULT_RECEIVED',
            id: card.id,
            result: entry.value,
          });
        }
      }
    } catch (e) {
      dispatch({
        type: 'CARD_VERIFY_FAILED',
        id: card.id,
        message: `Network error: ${(e as Error).message}`,
      });
    } finally {
      inFlightRef.current.delete(card.id);
    }
  }, []);

  const onVerifyAll = useCallback(async () => {
    const pending = stateRef.current.cards.filter((c) => c.status === 'pending');
    if (pending.length === 0) return;
    dispatch({ type: 'VERIFY_STARTED' });

    // Bounded concurrency — at most VERIFY_CONCURRENCY in flight at once.
    const queue = [...pending];
    const workers: Promise<void>[] = [];
    const next = async (): Promise<void> => {
      const card = queue.shift();
      if (!card) return;
      await verifyCard(card);
      await next();
    };
    for (let i = 0; i < Math.min(VERIFY_CONCURRENCY, queue.length); i++) {
      workers.push(next());
    }
    await Promise.all(workers);
    dispatch({ type: 'BATCH_COMPLETE' });
  }, [verifyCard]);

  const onRemoveCard = useCallback((id: string) => {
    dispatch({ type: 'CARD_REMOVED', id });
  }, []);

  const startOver = useCallback(() => {
    inFlightRef.current.clear();
    setStageError(null);
    dispatch({ type: 'START_OVER' });
  }, []);

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) stageFiles(files);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) stageFiles(files);
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
            Verify TTB COLA applications
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
            Drop one or many filled Form 5100.31 PDFs. The verifier reads each
            application + its affixed label, cross-checks them, and shows you
            exactly where every value came from on the source document.
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
              {isDragging ? 'Drop to upload' : 'Drop COLA application PDFs here'}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              or click anywhere in this box to browse
            </p>
            <p className="text-xs text-muted-foreground">
              TTB Form 5100.31 · PDF only · up to {MAX_PDF_BYTES / 1024 / 1024} MB each · drop multiple to batch
            </p>
          </label>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFileInput}
            className="sr-only"
            aria-label="Upload COLA application PDFs"
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

  // staged / processing / done — show the batch list.
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">
            {state.cards.length === 1
              ? state.cards[0]!.file.name
              : `Batch · ${state.cards.length} files`}
          </h1>
          {state.phase === 'processing' && (
            <p className="text-xs text-muted-foreground">
              Verifying — {state.cards.filter((c) => c.status === 'done').length}/
              {state.cards.length} done
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="pdf-add-more"
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent/40"
          >
            Add more PDFs
          </label>
          <input
            id="pdf-add-more"
            type="file"
            multiple
            accept="application/pdf,.pdf"
            onChange={handleFileInput}
            className="sr-only"
          />
          {state.phase === 'staged' && (
            <button
              type="button"
              onClick={onVerifyAll}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90"
            >
              Verify {state.cards.length === 1 ? '' : 'all '}
              ({state.cards.filter((c) => c.status === 'pending').length})
            </button>
          )}
          <button
            type="button"
            onClick={startOver}
            className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Start over"
          >
            Start over
          </button>
        </div>
      </header>

      {stageError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertTitle>Could not stage that file</AlertTitle>
          <AlertDescription>{stageError}</AlertDescription>
        </Alert>
      )}

      <BatchList cards={state.cards} onRemove={onRemoveCard} />
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
      /* not JSON */
    }
    return text;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

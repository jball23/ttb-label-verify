'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createWorkQueue, type WorkQueue } from '@/lib/concurrency/work-queue';
import { checkLabelImage } from '@/lib/labels/client-api';
import { type LabelView } from '@/lib/labels/label-view';
import { partitionLabelFiles } from '@/lib/upload/file-validation';
import { prepareImage } from '@/lib/upload/prepare-image';

/** How many labels are checked at once. Each is its own server request. */
export const VERIFY_CONCURRENCY = readConcurrency(process.env.NEXT_PUBLIC_VERIFY_CONCURRENCY);

export type BatchItemStatus = 'queued' | 'checking' | 'done' | 'failed';

export interface BatchItem {
  key: string;
  filename: string;
  previewUrl: string;
  status: BatchItemStatus;
  label?: LabelView;
  error?: string;
}

interface BatchContextValue {
  batchId: string | null;
  items: BatchItem[];
  concurrency: number;
  isRunning: boolean;
  /** Queues files for checking; returns the ones that cannot be checked, with why. */
  addFiles(files: File[]): Array<{ name: string; reason: string }>;
  retry(key: string): void;
  /** Keeps the batch list in step when a label is edited or decided elsewhere. */
  replaceLabel(view: LabelView): void;
}

const BatchContext = createContext<BatchContextValue | null>(null);

/**
 * Holds the current batch for the whole app shell, so it keeps running
 * while the reviewer opens individual labels.
 */
export function BatchProvider({ children }: { children: React.ReactNode }) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const files = useRef(new Map<string, File>());
  const previewUrls = useRef<string[]>([]);
  const batchIdRef = useRef<string | null>(null);

  const patch = useCallback((key: string, changes: Partial<BatchItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  const queue = useRef<WorkQueue<string> | null>(null);
  queue.current ??= createWorkQueue<string>(VERIFY_CONCURRENCY, async (key) => {
    const file = files.current.get(key);
    if (!file || !batchIdRef.current) return;
    patch(key, { status: 'checking', error: undefined });
    try {
      const label = await checkLabelImage(await prepareImage(file), batchIdRef.current);
      patch(key, { status: 'done', label });
    } catch (error) {
      patch(key, { status: 'failed', error: (error as Error).message });
    }
  });

  const addFiles = useCallback((selected: File[]) => {
    const { accepted, rejected } = partitionLabelFiles(selected);
    if (accepted.length > 0) {
      batchIdRef.current ??= crypto.randomUUID();
      setBatchId(batchIdRef.current);
      const added = accepted.map((file) => {
        const key = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        files.current.set(key, file);
        previewUrls.current.push(previewUrl);
        return { key, filename: file.name, previewUrl, status: 'queued' as const };
      });
      setItems((current) => [...current, ...added]);
      queue.current?.push(...added.map((item) => item.key));
    }
    return rejected.map(({ file, reason }) => ({ name: file.name, reason }));
  }, []);

  const retry = useCallback(
    (key: string) => {
      patch(key, { status: 'queued', error: undefined });
      queue.current?.push(key);
    },
    [patch],
  );

  const replaceLabel = useCallback((view: LabelView) => {
    setItems((current) => current.map((item) => (item.label?.id === view.id ? { ...item, label: view } : item)));
  }, []);

  const isRunning = items.some((item) => item.status === 'queued' || item.status === 'checking');

  // Closing the tab stops the batch, so say so before it happens.
  useEffect(() => {
    if (!isRunning) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isRunning]);

  // Previews live as long as the app shell; free them when it goes away.
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const value = useMemo(
    () => ({ batchId, items, concurrency: VERIFY_CONCURRENCY, isRunning, addFiles, retry, replaceLabel }),
    [batchId, items, isRunning, addFiles, retry, replaceLabel],
  );
  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}

export function useBatch(): BatchContextValue {
  const value = useContext(BatchContext);
  if (!value) throw new Error('useBatch must be used inside BatchProvider');
  return value;
}

function readConcurrency(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 6;
}

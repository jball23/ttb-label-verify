'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { ImageUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LABEL_IMAGE_MIME_TYPES } from '@/lib/labels/label-reader';
import { MAX_BATCH_SIZE } from '@/lib/upload/file-validation';
import { cn } from '@/lib/utils';
import { useBatch } from './batch-provider';
import { SampleLabelsButton } from './sample-labels-button';

/** One obvious place to drop or choose label photos. */
export function LabelDropzone({ compact = false }: { compact?: boolean }) {
  const { addFiles } = useBatch();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<Array<{ name: string; reason: string }>>([]);

  function take(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setRejected(addFiles([...files]));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card text-center transition-colors',
          compact ? 'px-6 py-6 sm:flex-row sm:justify-between sm:text-left' : 'px-6 py-14',
          dragging && 'border-foreground/40 bg-muted',
        )}
      >
        <div className={cn('flex flex-col items-center gap-2', compact && 'sm:flex-row sm:gap-4')}>
          <ImageUp aria-hidden className={cn('text-muted-foreground', compact ? 'size-8' : 'size-12')} />
          <div className="flex flex-col gap-1">
            <p className={cn('font-semibold', compact ? 'text-lg' : 'text-2xl')}>
              {compact ? 'Drop more label photos here' : 'Drop label photos here'}
            </p>
            <p className="text-base text-muted-foreground">
              JPG, PNG or WebP. Up to {MAX_BATCH_SIZE} at a time, front or back labels.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <label htmlFor={inputId} className="sr-only">
            Choose label photos
          </label>
          <input
            id={inputId}
            ref={input}
            type="file"
            multiple
            accept={LABEL_IMAGE_MIME_TYPES.join(',')}
            className="sr-only"
            onChange={(event) => {
              take(event.target.files);
              event.target.value = '';
            }}
          />
          <Button size="lg" className="text-base" onClick={() => input.current?.click()}>
            Choose photos
          </Button>
          {compact ? null : <SampleLabelsButton />}
        </div>
      </div>
      {rejected.length > 0 ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-base">
          <p className="font-semibold text-status-problem">
            {rejected.length === 1 ? 'One file was not added:' : `${rejected.length} files were not added:`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {rejected.slice(0, 5).map(({ name, reason }) => (
              <li key={name + reason}>
                {name}: {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

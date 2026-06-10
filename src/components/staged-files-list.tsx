'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Plus, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/upload/format-bytes';

interface Props {
  files: File[];
  onRemove(file: File): void;
  onVerify(): void;
  onAddMore(files: File[]): void;
}

export default function StagedFilesList({ files, onRemove, onVerify, onAddMore }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const newFiles = Array.from(e.target.files ?? []);
    if (newFiles.length > 0) onAddMore(newFiles);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            <span className="tabular-nums">{files.length}</span>{' '}
            {files.length === 1 ? 'label' : 'labels'} ready
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the queue, then verify.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {files.map((file, idx) => (
          <FileRow
            key={`${file.name}-${idx}`}
            file={file}
            onRemove={() => onRemove(file)}
          />
        ))}
      </ul>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          <Plus className="size-4" />
          Add more
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={handleChange}
          className="sr-only"
        />
        <Button type="button" size="lg" onClick={onVerify}>
          Verify {files.length} {files.length === 1 ? 'label' : 'labels'}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function FileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <FileText className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {formatBytes(file.size)} · {file.type.split('/')[1]?.toUpperCase() ?? 'FILE'}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}


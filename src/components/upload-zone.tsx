'use client';

import { useState, useRef, type DragEvent, type ReactNode } from 'react';
import { Upload, FileImage, Sparkles } from 'lucide-react';
import { ACCEPTED_MIME_TYPES, MAX_BATCH_SIZE } from '@/lib/upload/file-validation';
import { cn } from '@/lib/utils';

interface Props {
  onFilesSelected(files: File[]): void;
  scenarioPicker?: ReactNode;
}

const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(',');

export default function UploadZone({ onFilesSelected, scenarioPicker }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFilesSelected(files);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16 sm:px-6">
      <div className="mb-8 text-center sm:mb-12">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3" />
          PDF OCR · COLA cross-check + TTB rule engine
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Verify alcohol labels against a COLA application
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
          Pick a demo scenario to load a filled COLA application alongside its
          submitted label, then verify both against the TTB rules.
        </p>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'group relative overflow-hidden rounded-2xl border-2 border-dashed bg-muted/20 transition-all duration-200',
          isDragging
            ? 'border-foreground bg-[color-mix(in_srgb,var(--foreground)_4%,var(--card))] scale-[1.01]'
            : 'border-border hover:border-foreground/30 hover:bg-muted/40',
        )}
      >
        <label
          htmlFor="label-upload"
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
              <FileImage className="size-6 text-muted-foreground" />
            )}
          </div>
          <p className="mb-1.5 text-base font-medium">
            {isDragging ? 'Drop to upload' : 'Drop label images here'}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            or click anywhere in this box to browse
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>PNG · JPG · WebP · PDF</span>
            <span className="hidden sm:inline">·</span>
            <span>Up to {MAX_BATCH_SIZE} labels</span>
            <span className="hidden sm:inline">·</span>
            <span>10 MB each</span>
          </div>
        </label>
        <input
          ref={inputRef}
          id="label-upload"
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          onChange={handleChange}
          className="sr-only"
          aria-label="Upload label images"
        />
      </div>

      {scenarioPicker && <div className="mt-6">{scenarioPicker}</div>}
    </div>
  );
}

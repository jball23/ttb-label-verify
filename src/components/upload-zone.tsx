'use client';

import { useState, useRef, type DragEvent } from 'react';
import { FileInput, FileInputRef } from '@trussworks/react-uswds';
import { ACCEPTED_MIME_TYPES, MAX_BATCH_SIZE } from '@/lib/upload/file-validation';

interface Props {
  onFilesSelected(files: File[]): void;
  onSampleSelected(): void;
}

const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(',');

export default function UploadZone({ onFilesSelected, onSampleSelected }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<FileInputRef>(null);

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFilesSelected(files);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
    fileInputRef.current?.clearFiles();
  }

  return (
    <div className="grid-container padding-y-6">
      <div className="grid-row">
        <div className="grid-col-12 desktop:grid-col-8 desktop:grid-offset-2">
          <h1 className="font-serif-xl text-center margin-bottom-2">
            Verify alcohol labels against TTB compliance rules
          </h1>
          <p className="font-sans-md text-center text-base-darker margin-bottom-4">
            Drop label images below. Each label is checked in about five seconds.
          </p>
          <div
            className={`upload-zone bg-base-lightest padding-3 ${
              isDragging ? 'is-drag-over' : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="Drag and drop label images, or use the file picker below"
          >
            <FileInput
              ref={fileInputRef}
              id="label-upload"
              name="labels"
              multiple
              accept={ACCEPT_ATTR}
              onChange={handleFileInputChange}
            />
            <p className="font-sans-2xs text-base text-center margin-top-2 margin-bottom-0">
              PNG, JPG, WebP, or PDF · up to {MAX_BATCH_SIZE} labels per batch · max 10 MB each
            </p>
          </div>
          <div className="text-center margin-top-3">
            <button
              type="button"
              className="usa-button usa-button--unstyled"
              onClick={onSampleSelected}
            >
              Try a sample label
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

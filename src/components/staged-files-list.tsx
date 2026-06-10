'use client';

import { Button } from '@trussworks/react-uswds';
import { formatBytes } from '@/lib/upload/format-bytes';

interface Props {
  files: File[];
  onRemove(file: File): void;
  onVerify(): void;
  onAddMore(files: File[]): void;
}

export default function StagedFilesList({ files, onRemove, onVerify, onAddMore }: Props) {
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const newFiles = Array.from(e.target.files ?? []);
    if (newFiles.length > 0) onAddMore(newFiles);
    e.target.value = '';
  }

  return (
    <div className="grid-container padding-y-4">
      <div className="grid-row">
        <div className="grid-col-12 desktop:grid-col-8 desktop:grid-offset-2">
          <h2 className="font-serif-lg margin-bottom-3">
            {files.length} {files.length === 1 ? 'label' : 'labels'} ready to verify
          </h2>
          <ul className="usa-list usa-list--unstyled add-list-reset margin-bottom-4">
            {files.map((file, idx) => (
              <li
                key={`${file.name}-${idx}`}
                className="display-flex flex-align-center bg-white padding-2 margin-bottom-1 border border-base-lighter radius-sm"
              >
                <span className="flex-fill">
                  <strong className="display-block">{file.name}</strong>
                  <span className="font-sans-2xs text-base">
                    {formatBytes(file.size)} · {file.type || 'unknown type'}
                  </span>
                </span>
                <button
                  type="button"
                  className="usa-button usa-button--unstyled text-error margin-left-2"
                  onClick={() => onRemove(file)}
                  aria-label={`Remove ${file.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="display-flex flex-justify margin-top-3">
            <label
              htmlFor="add-more-input"
              className="usa-button usa-button--outline"
            >
              Add more labels
              <input
                id="add-more-input"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={handleFileInputChange}
                className="position-absolute opacity-0 width-1px height-1px overflow-hidden"
              />
            </label>
            <Button type="button" onClick={onVerify}>
              Verify {files.length} {files.length === 1 ? 'label' : 'labels'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

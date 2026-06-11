'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { X, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const PdfViewer = dynamic(() => import('./pdf-viewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading PDF viewer…
    </div>
  ),
});

type Source =
  | { kind: 'live'; file: File | Blob }
  | { kind: 'stored'; applicationId: string; hasStoredPdf: boolean };

interface Props {
  filename: string;
  source: Source;
  buttonLabel?: string;
}

/**
 * Click-to-open near-fullscreen modal showing a COLA PDF.
 *
 * Two modes:
 *  - `live`: the user just uploaded the file; pass the File/Blob directly.
 *  - `stored`: the PDF lives in the database; fetched via `/api/applications/[id]/pdf`.
 *
 * The blob is created on first open and cached for the lifetime of the
 * component. Cancellation guard prevents setState after unmount.
 */
export default function PdfModal({ filename, source, buttonLabel = 'View full PDF' }: Props) {
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(
    source.kind === 'live' ? source.file : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const disabled = source.kind === 'stored' && !source.hasStoredPdf;

  useEffect(() => {
    if (!open || blob || source.kind !== 'stored') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/applications/${source.applicationId}/pdf`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.blob();
      })
      .then((b) => {
        if (!cancelled) setBlob(b);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || 'Failed to load PDF');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, source, blob]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium',
          disabled
            ? 'cursor-not-allowed text-muted-foreground opacity-60'
            : 'hover:bg-accent/40',
        )}
        title={
          disabled
            ? 'Original PDF not stored for this application'
            : 'Open the PDF in a larger viewer'
        }
      >
        <FileText className="size-3.5" />
        {buttonLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Original PDF: ${filename}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="relative flex h-[95vh] w-[95vw] max-w-[1400px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <span className="truncate font-medium">{filename}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="Close PDF viewer"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loading && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading PDF…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Failed to load PDF: {error}
                </div>
              )}
              {blob && (
                <PdfViewer pdfFile={blob} provenance={{}} selectedFieldId={null} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

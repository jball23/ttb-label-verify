'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type {
  FieldPath,
  FieldProvenance,
  ProvenanceMap,
} from '@/lib/extraction/types';
import { cn } from '@/lib/utils';

// pdfjs worker is copied into public/ by an install-time step (documented in
// README). Setting workerSrc once is required by react-pdf.
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface Props {
  pdfFile: File | Blob | null;
  provenance: ProvenanceMap;
  selectedFieldId: FieldPath | null;
}

const DEFAULT_PAGE_WIDTH = 720;

export default function PdfViewer({
  pdfFile,
  provenance,
  selectedFieldId,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Pin the rendered page width to the container's actual width so the bbox
  // overlay coordinates (computed in normalized 0..1) stay aligned across
  // window-resize and devtools toggles.
  useEffect(() => {
    if (!containerRef.current) return;
    const node = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setPageWidth(Math.floor(w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // When selection changes, scroll the page that owns the selected bbox into
  // view. Non-selected bboxes are not drawn; only the selected one renders.
  const selectedEntry = selectedFieldId ? provenance[selectedFieldId] : null;
  useEffect(() => {
    if (!selectedEntry) return;
    const pageEl = pageRefs.current.get(selectedEntry.page);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedEntry]);

  if (!pdfFile) {
    return (
      <div
        ref={containerRef}
        className="flex h-full min-h-[300px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground"
      >
        Upload or pick a scenario PDF to see the source document here.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3">
      <Document
        file={pdfFile}
        onLoadSuccess={(p) => setNumPages(p.numPages)}
        loading={<div className="text-xs text-muted-foreground">Loading PDF…</div>}
        error={
          <div className="text-xs text-destructive">
            Could not display the PDF.
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => i).map((pageIdx) => {
          const showOverlay =
            selectedEntry !== null && selectedEntry !== undefined && selectedEntry.page === pageIdx;
          return (
            <div
              key={pageIdx}
              ref={(el) => {
                if (el) pageRefs.current.set(pageIdx, el);
              }}
              className="relative mb-4 inline-block bg-white shadow-sm"
            >
              <Page
                pageNumber={pageIdx + 1}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
              {showOverlay && selectedEntry && (
                <BboxHighlight provenance={selectedEntry} />
              )}
            </div>
          );
        })}
      </Document>
    </div>
  );
}

function BboxHighlight({ provenance }: { provenance: FieldProvenance }) {
  const style: CSSProperties = {
    left: `${provenance.bbox.x * 100}%`,
    top: `${provenance.bbox.y * 100}%`,
    width: `${provenance.bbox.w * 100}%`,
    height: `${provenance.bbox.h * 100}%`,
  };
  const isLow = provenance.confidence === 'low';
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-10 rounded-sm transition-all',
        isLow
          ? 'border-2 border-dashed border-amber-500/80 bg-amber-200/20'
          : 'border-2 border-sky-500 bg-sky-300/20 shadow-[0_0_0_4px_rgba(56,189,248,0.15)]',
      )}
      style={style}
    />
  );
}

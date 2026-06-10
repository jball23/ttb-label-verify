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
import { Minus, Plus, Maximize2 } from 'lucide-react';
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

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 2.5] as const;

export default function PdfViewer({
  pdfFile,
  provenance,
  selectedFieldId,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(720);
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_STEPS.indexOf(1.0));
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
      if (w && w > 0) setContainerWidth(Math.floor(w));
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

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1.0;
  const pageWidth = Math.floor(containerWidth * zoom);

  function zoomIn(): void {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  }
  function zoomOut(): void {
    setZoomIndex((i) => Math.max(0, i - 1));
  }
  function zoomReset(): void {
    setZoomIndex(ZOOM_STEPS.indexOf(1.0));
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3">
      <div className="sticky top-0 z-20 flex w-full items-center justify-end gap-1 rounded-md border border-border bg-card/95 px-2 py-1 backdrop-blur">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoomIndex === 0}
          aria-label="Zoom out"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={zoomReset}
          aria-label={`Reset zoom (currently ${Math.round(zoom * 100)}%)`}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <Maximize2 className="size-3" />
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          aria-label="Zoom in"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
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

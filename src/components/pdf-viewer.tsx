'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import type {
  FieldBbox,
  FieldBboxes,
  FieldPath,
  FieldProvenance,
  ProvenanceMap,
  WordRect,
} from '@/lib/extraction/types';
import { cn } from '@/lib/utils';

/**
 * The Tesseract pipeline rasterizes PDF pages at this DPI (see
 * src/lib/pdf/render.ts). Word-rect coordinates land in pixel space at this
 * resolution, so we convert back to normalized 0..1 by dividing by
 * (page-pt-dimension × DPI/72).
 */
const RENDER_DPI = 200;
const SELECTION_SCROLL_TOP_PADDING = 96;

// pdfjs worker is copied into public/ by an install-time step (documented in
// README). Setting workerSrc once is required by react-pdf.
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface Props {
  pdfFile: File | Blob | null;
  /** Legacy single-bbox provenance from the full-document OpenAI path. */
  provenance: ProvenanceMap;
  /** Current per-field source sidecar. Preferred when present for a field. */
  bboxes?: FieldBboxes;
  selectedFieldId: FieldPath | null;
  selectedPageHint?: number | null;
  /**
   * When set, render only this 1-indexed page (rest of the document is
   * hidden). Used by the source-viewer tab strip so each tab shows exactly
   * one page. Falsy → render every page stacked (legacy modal behavior).
   */
  singlePage?: number | null;
  pages?: ReadonlyArray<{ pageNumber: number; kind: string }>;
}

type LoadedPdfPage = {
  originalWidth: number;
  originalHeight: number;
  getTextContent(): Promise<{ items: unknown[] }>;
};

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 2.5] as const;

export default function PdfViewer({
  pdfFile,
  provenance,
  bboxes,
  selectedFieldId,
  selectedPageHint,
  singlePage,
  pages,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(720);
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_STEPS.indexOf(1.0));
  // Per-page natural pt dimensions, captured from react-pdf's Page
  // onLoadSuccess. Used to convert Tesseract pixel-space WordRects to
  // normalized 0..1 overlay coords without the API having to ship a
  // page-size sidecar. 1-indexed to match FieldBbox.page.
  const [pagePts, setPagePts] = useState<
    Map<number, { width: number; height: number }>
  >(new Map());
  const [pageContentRight, setPageContentRight] = useState<Map<number, number>>(
    new Map(),
  );
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Drag-to-pan state — only active when zoomed past 100% so single-click
  // selection isn't hijacked at the default zoom. Tracks the initial mouse
  // position + scrollLeft/Top at mousedown so the delta translates to a
  // scroll offset on subsequent mousemove events.
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollX: number;
    scrollY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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

  useEffect(() => {
    setNumPages(0);
    setPagePts(new Map());
    setPageContentRight(new Map());
    pageCanvasRefs.current.clear();
    pageRefs.current.clear();
  }, [pdfFile]);

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1.0;
  const pageWidth = Math.floor(containerWidth * zoom);

  // When selection changes, scroll the page that owns the selected source into
  // view. For OCR fields, prefer the first highlighted word; for VLM/no-word
  // fields, use the page hint and leave a top cushion so the app header never
  // covers the evidence.
  // The new Tesseract bbox sidecar wins over the legacy provenance map when
  // both are present — the latter is `{}` under the Tesseract pipeline today,
  // but keeping the precedence explicit makes the dual-path render unambiguous.
  const selectedBbox: FieldBbox | null =
    selectedFieldId && bboxes ? bboxes[selectedFieldId] ?? null : null;
  const selectedEntry: FieldProvenance | null =
    selectedFieldId && !selectedBbox ? provenance[selectedFieldId] ?? null : null;
  const selectedPageNumber =
    selectedBbox && selectedBbox.source !== 'vlm' && selectedBbox.words.length > 0
      ? selectedBbox.page
      : selectedPageHint ?? selectedBbox?.page ?? (selectedEntry ? selectedEntry.page + 1 : null);
  useEffect(() => {
    if (selectedPageNumber === null || !scrollRef.current) return;
    const pageEl = pageRefs.current.get(selectedPageNumber);
    if (!pageEl) return;

    let targetTop = pageEl.offsetTop - SELECTION_SCROLL_TOP_PADDING;
    if (
      selectedBbox &&
      selectedBbox.source !== 'vlm' &&
      selectedBbox.words.length > 0 &&
      selectedBbox.page === selectedPageNumber
    ) {
      const pt = pagePts.get(selectedBbox.page);
      if (pt) {
        const pixelWidth = pt.width * (RENDER_DPI / 72);
        const firstY = Math.min(...selectedBbox.words.map((w) => w.bbox.y0));
        const pageInner = pageEl.querySelector<HTMLElement>('[data-pdf-page-inner]');
        const renderWidth = pageInner?.clientWidth ?? pageWidth;
        targetTop =
          pageEl.offsetTop +
          (firstY / pixelWidth) * renderWidth -
          SELECTION_SCROLL_TOP_PADDING;
      }
    } else if (selectedEntry) {
      targetTop =
        pageEl.offsetTop +
        selectedEntry.bbox.y * pageEl.clientHeight -
        SELECTION_SCROLL_TOP_PADDING;
    }

    scrollRef.current.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [
    selectedPageNumber,
    selectedBbox,
    selectedEntry,
    pagePts,
    pageWidth,
    numPages,
  ]);

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

  const canPan = zoom > 1.0;
  const applicationBboxPages = new Set(
    Object.entries(bboxes ?? {})
      .filter(([path]) => path.startsWith('application.'))
      .map(([, bbox]) => bbox.page),
  );

  function isFormPage(pageNumber: number): boolean {
    const pageMeta = pages?.find((p) => p.pageNumber === pageNumber);
    if (pageMeta) return pageMeta.kind.includes('form');
    return applicationBboxPages.has(pageNumber);
  }

  function formPageFitScale(pageNumber: number): number {
    if (!isFormPage(pageNumber)) return 1;
    const right = pageContentRight.get(pageNumber);
    if (!right || right >= 0.985) return 1;
    return Math.min(1.22, Math.max(1, 1 / right));
  }

  function capturePageTextBounds(pageNumber: number, page: LoadedPdfPage): void {
    void page.getTextContent().then((content) => {
      const rightEdges: number[] = [];
      for (const item of content.items) {
        if (typeof item !== 'object' || item === null) continue;
        const textItem = item as { transform?: unknown; width?: unknown };
        if (!Array.isArray(textItem.transform)) continue;
        const x = Number(textItem.transform[4]);
        const width = Number(textItem.width ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(width)) continue;
        rightEdges.push(x + Math.max(0, width));
      }
      if (rightEdges.length === 0) return;
      rightEdges.sort((a, b) => a - b);
      const percentileIndex = Math.max(
        0,
        Math.ceil(rightEdges.length * 0.98) - 1,
      );
      const textRight = rightEdges[percentileIndex] ?? rightEdges.at(-1) ?? 0;
      if (textRight <= 0) return;
      const right = Math.min(1, (textRight + 18) / page.originalWidth);
      setPageContentRight((prev) => {
        if (prev.get(pageNumber) === right) return prev;
        const next = new Map(prev);
        next.set(pageNumber, right);
        return next;
      });
    }).catch(() => undefined);
  }

  function captureCanvasBounds(pageNumber: number): void {
    const canvas = pageCanvasRefs.current.get(pageNumber);
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const stepX = Math.max(1, Math.floor(canvas.width / 900));
    const stepY = Math.max(1, Math.floor(canvas.height / 900));
    const whiteThreshold = 246;
    let maxX = 0;
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const offset = (y * width + x) * 4;
        const r = data[offset] ?? 255;
        const g = data[offset + 1] ?? 255;
        const b = data[offset + 2] ?? 255;
        const alpha = data[offset + 3] ?? 255;
        if (
          alpha > 16 &&
          (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold)
        ) {
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (maxX <= 0) return;
    const right = Math.min(1, (maxX + 18) / canvas.width);
    setPageContentRight((prev) => {
      const existing = prev.get(pageNumber);
      if (existing && existing <= right) return prev;
      const next = new Map(prev);
      next.set(pageNumber, right);
      return next;
    });
  }

  function zoomIn(): void {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  }
  function zoomOut(): void {
    setZoomIndex((i) => Math.max(0, i - 1));
  }
  function zoomReset(): void {
    setZoomIndex(ZOOM_STEPS.indexOf(1.0));
  }

  function onPanStart(e: ReactMouseEvent<HTMLDivElement>): void {
    if (!canPan || !scrollRef.current) return;
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollX: scrollRef.current.scrollLeft,
      scrollY: scrollRef.current.scrollTop,
    };
    setIsPanning(true);
    e.preventDefault();
  }
  function onPanMove(e: ReactMouseEvent<HTMLDivElement>): void {
    if (!isPanning || !panStateRef.current || !scrollRef.current) return;
    const dx = e.clientX - panStateRef.current.startX;
    const dy = e.clientY - panStateRef.current.startY;
    scrollRef.current.scrollLeft = panStateRef.current.scrollX - dx;
    scrollRef.current.scrollTop = panStateRef.current.scrollY - dy;
  }
  function onPanEnd(): void {
    panStateRef.current = null;
    setIsPanning(false);
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-2">
      <div className="flex w-full items-center justify-end gap-1 rounded-md border border-border bg-card/95 px-2 py-1 backdrop-blur">
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
      <div
        ref={scrollRef}
        data-pdf-scroll="true"
        onMouseDown={onPanStart}
        onMouseMove={onPanMove}
        onMouseUp={onPanEnd}
        onMouseLeave={onPanEnd}
        className={cn(
          'min-h-0 flex-1 overflow-auto rounded-md',
          canPan ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
        )}
      >
        <Document
          file={pdfFile}
          onLoadSuccess={(p) => setNumPages(p.numPages)}
          loading={
            <div className="text-xs text-muted-foreground">Loading PDF…</div>
          }
          error={
            <div className="text-xs text-destructive">
              Could not display the PDF.
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, i) => i)
            .filter((pageIdx) => singlePage == null || pageIdx + 1 === singlePage)
            .map((pageIdx) => {
              const pageNumber = pageIdx + 1;
              // FieldBbox.page is 1-indexed; legacy provenance.page is 0-indexed.
              const showWordRects =
                selectedBbox !== null && selectedBbox.page === pageNumber;
              const showLegacyBbox =
                selectedEntry !== null && selectedEntry.page === pageIdx;
              const pt = pagePts.get(pageNumber);
              const fitScale = formPageFitScale(pageNumber);
              const renderWidth = Math.floor(pageWidth * fitScale);
              return (
                <div
                  key={pageIdx}
                  ref={(el) => {
                    if (el) {
                      pageRefs.current.set(pageNumber, el);
                    } else {
                      pageRefs.current.delete(pageNumber);
                    }
                  }}
                  className="mb-4 inline-block overflow-hidden bg-white shadow-sm"
                  data-form-fit={fitScale > 1 ? 'true' : 'false'}
                  data-fit-scale={fitScale.toFixed(3)}
                  data-pdf-page={pageNumber}
                  style={{ width: pageWidth }}
                >
                  <div
                    className="relative bg-white"
                    data-pdf-page-inner={pageNumber}
                    style={{ width: renderWidth }}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={renderWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      canvasRef={(canvas) => {
                        if (canvas) pageCanvasRefs.current.set(pageNumber, canvas);
                        else pageCanvasRefs.current.delete(pageNumber);
                      }}
                      onLoadSuccess={(p) => {
                        // originalWidth/originalHeight are the PDF's natural pt
                        // dimensions before react-pdf's display scaling — exactly
                        // what we need to denominate WordRect pixel coords.
                        setPagePts((prev) => {
                          const existing = prev.get(pageNumber);
                          if (
                            existing &&
                            existing.width === p.originalWidth &&
                            existing.height === p.originalHeight
                          ) {
                            return prev;
                          }
                          const next = new Map(prev);
                          next.set(pageNumber, {
                            width: p.originalWidth,
                            height: p.originalHeight,
                          });
                          return next;
                        });
                        if (isFormPage(pageNumber)) {
                          capturePageTextBounds(pageNumber, p);
                        }
                      }}
                      onRenderSuccess={() => {
                        if (isFormPage(pageNumber)) {
                          captureCanvasBounds(pageNumber);
                        }
                      }}
                    />
                    {showWordRects && selectedBbox && pt && (
                      <WordRectsHighlight
                        bbox={selectedBbox}
                        fieldPath={selectedFieldId}
                        pagePt={pt}
                      />
                    )}
                    {showLegacyBbox && selectedEntry && (
                      <BboxHighlight provenance={selectedEntry} />
                    )}
                  </div>
                </div>
              );
            })}
        </Document>
      </div>
    </div>
  );
}

/**
 * Per-word overlay for the bbox sidecar. Each word renders as its own
 * absolute-positioned div over the rendered page; the parent container is
 * the same `relative` wrapper that holds the react-pdf `<Page>`, so % units
 * resolve to the displayed page size automatically.
 *
 * Coordinate math: WordRect.x0/y0/x1/y1 are in 200-DPI PNG pixel space.
 * The PDF page's natural pt size × (DPI/72) is the source pixel-space
 * width/height, so dividing yields a 0..1 normalized coord that maps to %.
 *
 * VLM-fallback fields have `source: 'vlm'` and `words: []`; this component
 * renders nothing in that case — the caller is expected to surface a
 * "source not available" affordance separately (U8).
 */
function WordRectsHighlight({
  bbox,
  fieldPath,
  pagePt,
}: {
  bbox: FieldBbox;
  fieldPath: FieldPath | null;
  pagePt: { width: number; height: number };
}) {
  if (bbox.source === 'vlm' || bbox.words.length === 0) return null;
  const pixelWidth = pagePt.width * (RENDER_DPI / 72);
  const pixelHeight = pagePt.height * (RENDER_DPI / 72);
  const isLow = bbox.meanConfidence !== null && bbox.meanConfidence < 70;
  if (fieldPath === 'label.governmentWarning') {
    return (
      <RegionRectDiv
        words={bbox.words}
        pixelWidth={pixelWidth}
        pixelHeight={pixelHeight}
        isLow={isLow}
      />
    );
  }
  return (
    <>
      {bbox.words.map((w, i) => (
        <WordRectDiv
          key={i}
          word={w}
          pixelWidth={pixelWidth}
          pixelHeight={pixelHeight}
          isLow={isLow}
        />
      ))}
    </>
  );
}

function RegionRectDiv({
  words,
  pixelWidth,
  pixelHeight,
  isLow,
}: {
  words: WordRect[];
  pixelWidth: number;
  pixelHeight: number;
  isLow: boolean;
}) {
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const y0 = Math.min(...words.map((w) => w.bbox.y0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const y1 = Math.max(...words.map((w) => w.bbox.y1));
  const style: CSSProperties = {
    left: `${(x0 / pixelWidth) * 100}%`,
    top: `${(y0 / pixelHeight) * 100}%`,
    width: `${((x1 - x0) / pixelWidth) * 100}%`,
    height: `${((y1 - y0) / pixelHeight) * 100}%`,
  };
  return (
    <div
      aria-hidden
      data-field-highlight="true"
      className={cn(
        'pointer-events-none absolute z-10 rounded-[3px] transition-all',
        isLow
          ? 'border-2 border-dashed border-amber-500/85 bg-amber-200/20'
          : 'border-2 border-sky-500 bg-sky-300/15 shadow-[0_0_0_3px_rgba(56,189,248,0.16)]',
      )}
      style={style}
    />
  );
}

function WordRectDiv({
  word,
  pixelWidth,
  pixelHeight,
  isLow,
}: {
  word: WordRect;
  pixelWidth: number;
  pixelHeight: number;
  isLow: boolean;
}) {
  const style: CSSProperties = {
    left: `${(word.bbox.x0 / pixelWidth) * 100}%`,
    top: `${(word.bbox.y0 / pixelHeight) * 100}%`,
    width: `${((word.bbox.x1 - word.bbox.x0) / pixelWidth) * 100}%`,
    height: `${((word.bbox.y1 - word.bbox.y0) / pixelHeight) * 100}%`,
  };
  return (
    <div
      aria-hidden
      data-field-highlight="true"
      className={cn(
        'pointer-events-none absolute z-10 rounded-[2px] transition-all',
        isLow
          ? 'border-[1.5px] border-dashed border-amber-500/80 bg-amber-200/25'
          : 'border-[1.5px] border-sky-500 bg-sky-300/25 shadow-[0_0_0_2px_rgba(56,189,248,0.18)]',
      )}
      style={style}
    />
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
      data-field-highlight="true"
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

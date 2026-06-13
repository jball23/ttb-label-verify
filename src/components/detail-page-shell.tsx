'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import DetailReportView from './detail-report-view';
import SourceViewer from './source-viewer';
import {
  selectField,
  type PageMeta,
} from '@/lib/detail-view/select-field';
import { type FieldPath } from '@/lib/extraction/types';
import { type ResultLine } from '@/lib/results/result-types';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

interface Props {
  report: WireReport;
  applicationId: string;
  hasStoredPdf: boolean;
  leftFooter?: ReactNode;
}

// Display labels for the no-source overlay. Mirrors the labels in
// report-sections.tsx's CROSS_CHECK_FIELDS / RULE_TO_LABEL_PATH / relevant form fields
// for the most-likely-clicked paths; falls back to the raw FieldPath token
// when an entry isn't present (acceptable — the path is still readable).
const FIELD_LABELS: Partial<Record<FieldPath, string>> = {
  'label.brandName': 'Brand name (label)',
  'label.abv': 'Alcohol by volume',
  'label.netContents': 'Net contents',
  'label.producer': 'Producer / bottler',
  'label.countryOfOrigin': 'Country of origin',
  'label.governmentWarning': 'Government Warning',
  'label.classType': 'Class / type',
  'label.wineVarietal': 'Wine varietal',
  'label.wineAppellation': 'Wine appellation',
  'application.brandName': 'Brand name (Item 6)',
  'application.fancifulName': 'Fanciful name (Item 7)',
  'application.productType': 'Type of product (Item 5)',
  'application.applicant.name': 'Applicant name (Item 8)',
  'application.classType': 'Type of product (application)',
  'application.wineAppellation': 'Wine appellation (Item 11)',
  'application.grapeVarietals': 'Grape varietal (Item 10)',
};

/**
 * Client wrapper for the detail page. Owns the shared `selectedFieldId`
 * state so a click in the left-pane report drives the bbox highlight in
 * the full original PDF.
 *
 * Field source metadata lives in `lib/detail-view/select-field.ts`
 * (pure, tested). This component is plumbing only.
 */
export default function DetailPageShell({
  report,
  applicationId,
  hasStoredPdf,
  leftFooter,
}: Props) {
  const pages: ReadonlyArray<PageMeta> | undefined = report.pages;
  const [selectedFieldId, setSelectedFieldId] = useState<FieldPath | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [leftContentHeight, setLeftContentHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!hasStoredPdf) return;
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/pdf`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.blob();
      })
      .then((b) => {
        if (!cancelled) setBlob(b);
      })
      .catch((e) => {
        if (!cancelled) setPdfError((e as Error).message || 'Failed to load PDF');
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, hasStoredPdf]);

  useEffect(() => {
    const el = leftColumnRef.current;
    if (!el) return;

    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top;
        const bottom = Array.from(el.children).reduce((max, child) => {
          return Math.max(max, child.getBoundingClientRect().bottom);
        }, top);
        const next = Math.ceil(Math.max(0, bottom - top));
        setLeftContentHeight((current) =>
          current !== null && Math.abs(current - next) < 2 ? current : next,
        );
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [leftFooter, report]);

  // Field click → selection routing. Toggles off on second click of the
  // same field (matches the prior detail-report-view affordance).
  function handleSelectField(path: FieldPath | null): void {
    if (path === null || path === selectedFieldId) {
      setSelectedFieldId(null);
      return;
    }
    setSelectedFieldId(path);
  }

  // Resolve the VLM-fallback / overlay state for the currently selected
  // field, used by SourceViewer to render NoSourceOverlay.
  const selection = selectedFieldId
    ? selectField(selectedFieldId, report.bboxes, pages)
    : null;
  const isVlmFallback = selection?.isVlmFallback ?? false;
  const selectedFieldLabel = selectedFieldId
    ? FIELD_LABELS[selectedFieldId] ?? selectedFieldId
    : undefined;
  const pdfColumnStyle = {
    '--review-left-height': leftContentHeight
      ? `${leftContentHeight}px`
      : '70vh',
  } as CSSProperties & Record<'--review-left-height', string>;

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
      <div ref={leftColumnRef} className="flex min-h-0 flex-col gap-4">
        <DetailReportView
          report={report}
          selectedFieldId={selectedFieldId}
          onSelectField={handleSelectField}
        />
        {leftFooter}
      </div>
      <div
        className="min-h-[28rem] lg:h-[var(--review-left-height)] lg:min-h-0"
        style={pdfColumnStyle}
      >
        <div className="sticky top-4 flex h-[70vh] flex-col rounded-xl border border-border bg-card p-2 lg:h-full lg:min-h-0">
          {!hasStoredPdf ? (
            <div className="flex h-64 items-center justify-center px-4 text-center text-xs text-muted-foreground">
              Original PDF not stored for this application. Click-to-highlight is unavailable.
            </div>
          ) : pdfError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Failed to load PDF: {pdfError}
            </div>
          ) : (
            <SourceViewer
              pdfFile={blob}
              provenance={report.provenance}
              bboxes={report.bboxes}
              pages={report.pages}
              selectedFieldId={selectedFieldId}
              selectedPageHint={selection?.page ?? null}
              isVlmFallback={isVlmFallback}
              selectedFieldLabel={selectedFieldLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

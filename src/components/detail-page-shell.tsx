'use client';

import { useEffect, useState } from 'react';
import DetailReportView from './detail-report-view';
import SourceViewer from './source-viewer';
import {
  pageForTab,
  selectField,
  type PageMeta,
  type SourceTab,
} from '@/lib/detail-view/select-field';
import { type FieldPath } from '@/lib/extraction/types';
import { type ResultLine } from '@/lib/results/result-types';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

interface Props {
  report: WireReport;
  applicationId: string;
  hasStoredPdf: boolean;
}

// Display labels for the no-source overlay. Mirrors the labels in
// report-sections.tsx's CROSS_CHECK_FIELDS / RULE_TO_LABEL_PATH / APP_FORM_FIELDS
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
  'application.classType': 'Class / type (application)',
  'application.wineAppellation': 'Wine appellation (Item 11)',
  'application.grapeVarietals': 'Grape varietal (Item 10)',
};

/**
 * Client wrapper for the detail page. Owns the shared `selectedFieldId`
 * and `activeTab` state so a click in the left-pane report drives both the
 * bbox highlight AND the tab switch in the right-pane source viewer.
 *
 * Field-to-tab routing logic lives in `lib/detail-view/select-field.ts`
 * (pure, tested). This component is plumbing only.
 */
export default function DetailPageShell({
  report,
  applicationId,
  hasStoredPdf,
}: Props) {
  const pages: ReadonlyArray<PageMeta> | undefined = report.pages;
  const [selectedFieldId, setSelectedFieldId] = useState<FieldPath | null>(null);
  const [activeTab, setActiveTab] = useState<SourceTab>(() => {
    // Default order: front → back → form. The front label is what a
    // reviewer wants to see first (brand name, ABV, fanciful name),
    // back is second (GW + producer), and form last — form-side data
    // will Phase-B-load asynchronously, so showing it as the landing
    // tab would surface empty spinners.
    if (pageForTab('front', report.bboxes, pages) !== null) return 'front';
    if (pageForTab('back', report.bboxes, pages) !== null) return 'back';
    if (pageForTab('form', report.bboxes, pages) !== null) return 'form';
    return 'front';
  });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

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

  // Field click → selection routing. Toggles off on second click of the
  // same field (matches the prior detail-report-view affordance).
  function handleSelectField(path: FieldPath | null): void {
    if (path === null || path === selectedFieldId) {
      setSelectedFieldId(null);
      return;
    }
    setSelectedFieldId(path);
    const selection = selectField(path, report.bboxes, pages);
    setActiveTab(selection.tab);
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DetailReportView
        report={report}
        selectedFieldId={selectedFieldId}
        onSelectField={handleSelectField}
      />
      <div>
        <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col rounded-xl border border-border bg-card p-2">
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
              pages={pages}
              selectedFieldId={selectedFieldId}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              isVlmFallback={isVlmFallback}
              selectedFieldLabel={selectedFieldLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

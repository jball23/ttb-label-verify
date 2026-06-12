'use client';

import nextDynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import SourceViewerTabs from './source-viewer-tabs';
import NoSourceOverlay from './no-source-overlay';
import {
  availableTabs,
  pageForTab,
  type PageMeta,
  type SourceTab,
} from '@/lib/detail-view/select-field';
import {
  type FieldBboxes,
  type FieldPath,
  type ProvenanceMap,
} from '@/lib/extraction/types';

const PdfViewer = nextDynamic(() => import('./pdf-viewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[300px] items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading PDF viewer…
    </div>
  ),
});

interface Props {
  pdfFile: Blob | null;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
  /** Render-classifier page list — drives tab availability + page selection. */
  pages?: ReadonlyArray<PageMeta>;
  selectedFieldId: FieldPath | null;
  activeTab: SourceTab;
  onTabChange(tab: SourceTab): void;
  /** True when the currently-selected field came from VLM fallback. */
  isVlmFallback: boolean;
  /** Display label for the selected field, used in the no-source overlay. */
  selectedFieldLabel?: string;
}

/**
 * The right-pane source viewer (U7). Composes:
 *   - SourceViewerTabs — Form / Front / Back picker, greyed when no page,
 *   - PdfViewer — renders the single page that matches the active tab,
 *   - NoSourceOverlay — shown when the selected field is VLM-fallback.
 *
 * The tab is the source of truth for which page renders; field clicks
 * upstream in DetailPageShell flow into both `selectedFieldId` (drives
 * highlight + scroll inside PdfViewer) and `activeTab` (drives which page
 * the viewer shows at all).
 */
export default function SourceViewer({
  pdfFile,
  provenance,
  bboxes,
  pages,
  selectedFieldId,
  activeTab,
  onTabChange,
  isVlmFallback,
  selectedFieldLabel,
}: Props) {
  const available = availableTabs(bboxes, pages);
  const page = pageForTab(activeTab, bboxes, pages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SourceViewerTabs
        active={activeTab}
        available={available}
        onChange={onTabChange}
      />
      <div className="relative mt-2 flex min-h-0 flex-1 flex-col">
        {pdfFile && page !== null ? (
          <PdfViewer
            pdfFile={pdfFile}
            provenance={provenance}
            bboxes={bboxes}
            selectedFieldId={selectedFieldId}
            singlePage={page}
          />
        ) : (
          <div className="flex min-h-[300px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {pdfFile
              ? `No ${activeTab} page available for this application.`
              : 'Loading the original PDF…'}
          </div>
        )}
        {isVlmFallback && pdfFile && page !== null && (
          <NoSourceOverlay fieldLabel={selectedFieldLabel} />
        )}
      </div>
    </div>
  );
}

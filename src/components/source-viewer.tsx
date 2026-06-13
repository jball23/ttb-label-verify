'use client';

import nextDynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import NoSourceOverlay from './no-source-overlay';
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
  pages?: ReadonlyArray<{ pageNumber: number; kind: string }>;
  selectedFieldId: FieldPath | null;
  selectedPageHint?: number | null;
  /** True when the currently-selected field came from VLM fallback. */
  isVlmFallback: boolean;
  /** Display label for the selected field, used in the no-source overlay. */
  selectedFieldLabel?: string;
}

/**
 * The right-pane source viewer. The original uploaded PDF is the source of
 * truth; field clicks highlight/scroll inside that full document rather than
 * swapping between front/back image-style tabs.
 */
export default function SourceViewer({
  pdfFile,
  provenance,
  bboxes,
  pages,
  selectedFieldId,
  selectedPageHint,
  isVlmFallback,
  selectedFieldLabel,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        {pdfFile ? (
          <PdfViewer
            pdfFile={pdfFile}
            provenance={provenance}
            bboxes={bboxes}
            pages={pages}
            selectedFieldId={selectedFieldId}
            selectedPageHint={selectedPageHint}
          />
        ) : (
          <div className="flex min-h-[300px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Loading the original PDF…
          </div>
        )}
        {isVlmFallback && pdfFile && (
          <NoSourceOverlay fieldLabel={selectedFieldLabel} />
        )}
      </div>
    </div>
  );
}

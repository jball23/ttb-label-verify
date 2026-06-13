'use client';

import { useState } from 'react';
import {
  type FieldBboxes,
  type FieldPath,
  type ProvenanceMap,
} from '@/lib/extraction/types';
import { type ResultLine } from '@/lib/results/result-types';
import { RulesSection } from './report-sections';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

interface Props {
  report: WireReport;
  /**
   * Controlled selection — when provided alongside `onSelectField`, the
   * parent owns selection state (used by DetailPageShell so the inline PDF
   * viewer reacts to clicks). When omitted, this component manages its own
   * state for backward-compat callers.
   */
  selectedFieldId?: FieldPath | null;
  onSelectField?(path: FieldPath | null): void;
}

/**
 * Read-only renderer of a stored verification report. Now dual-mode:
 *  - Uncontrolled (legacy): manages its own selectedFieldId; clicks just
 *    toggle the row highlight.
 *  - Controlled (DetailPageShell): selection state lives in the parent so
 *    the inline PDF viewer can render the bbox highlight.
 *
 * Both modes thread the new `bboxes` sidecar into the report sections so a
 * row stays clickable whenever Tesseract produced word rects for the field
 * — even though the legacy `provenance` map is empty under the Tesseract
 * pipeline.
 */
export default function DetailReportView({
  report,
  selectedFieldId: controlledSelectedFieldId,
  onSelectField,
}: Props) {
  const [internalSelectedFieldId, setInternalSelectedFieldId] = useState<FieldPath | null>(null);
  const isControlled = onSelectField !== undefined;
  const selectedFieldId = isControlled
    ? controlledSelectedFieldId ?? null
    : internalSelectedFieldId;
  const provenance: ProvenanceMap = report.provenance;
  const bboxes: FieldBboxes | undefined = report.bboxes;

  function select(path: FieldPath | null): void {
    const next = selectedFieldId === path ? null : path;
    if (isControlled) onSelectField(next);
    else setInternalSelectedFieldId(next);
  }

  // One focused review surface: the TTB label rules card owns both the
  // label-only requirements and the app-vs-label comparisons needed to assess
  // those same requirements. No separate comparison panel.
  return (
    <div className="space-y-4">
      <RulesSection
        report={report}
        selectedFieldId={selectedFieldId}
        onSelect={select}
        provenance={provenance}
        bboxes={bboxes}
      />
    </div>
  );
}

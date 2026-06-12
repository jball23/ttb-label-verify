'use client';

import { useState } from 'react';
import {
  type FieldBboxes,
  type FieldPath,
  type ProvenanceMap,
} from '@/lib/extraction/types';
import { type ResultLine } from '@/lib/results/result-types';
import { CrossCheckSection, RulesSection } from './report-sections';

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

  // Order matters: the TTB Label Rules drive the verdict — Government
  // Warning (§16.21), ABV format, brand presence, etc. — so they sit at the
  // top of the report. The cross-check section is informational; it
  // surfaces side-by-side comparisons the reviewer's eye does anyway
  // ("matching" work, per the stakeholder interviews), but TTB approves
  // plenty of labels with applicant-vs-producer or country phrasing drift,
  // so we don't let it drive the verdict.
  return (
    <div className="space-y-4">
      <RulesSection
        fields={report.fields}
        selectedFieldId={selectedFieldId}
        onSelect={select}
        provenance={provenance}
        bboxes={bboxes}
      />
      {/* Phase A: cross-check is undefined while form-side OCR is still
          running on the async patch path. Phase B replaces this guard with
          a per-field spinner row. */}
      {report.crossCheck && (
        <CrossCheckSection
          report={report.crossCheck}
          selectedFieldId={selectedFieldId}
          onSelect={select}
          provenance={provenance}
          bboxes={bboxes}
        />
      )}
    </div>
  );
}

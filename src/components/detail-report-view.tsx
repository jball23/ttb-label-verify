'use client';

import { useState } from 'react';
import { type FieldPath, type ProvenanceMap } from '@/lib/extraction/types';
import { type ResultLine } from '@/lib/results/result-types';
import {
  CrossCheckSection,
  RulesSection,
  ApplicationFieldsSection,
} from './report-sections';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

interface Props {
  report: WireReport;
}

/**
 * Read-only renderer of a stored verification report for the
 * `/applications/[id]` detail page. Manages its own selectedFieldId so the
 * parent (a server component) doesn't have to pass a function handler across
 * the server/client boundary.
 *
 * The PDF bytes are not displayed inline here — the detail page is a
 * passive review surface. The reviewer opens the original PDF via a separate
 * modal (see PdfModal).
 */
export default function DetailReportView({ report }: Props) {
  const [selectedFieldId, setSelectedFieldId] = useState<FieldPath | null>(null);
  const provenance: ProvenanceMap = report.provenance;

  function select(path: FieldPath | null): void {
    setSelectedFieldId((current) => (current === path ? null : path));
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
      />
      <CrossCheckSection
        report={report.crossCheck}
        selectedFieldId={selectedFieldId}
        onSelect={select}
        provenance={provenance}
      />
      <ApplicationFieldsSection
        form={report.extractedForm}
        selectedFieldId={selectedFieldId}
        onSelect={select}
        provenance={provenance}
      />
    </div>
  );
}

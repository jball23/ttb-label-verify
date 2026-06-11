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

  return (
    <div className="space-y-4">
      <CrossCheckSection
        report={report.crossCheck}
        selectedFieldId={selectedFieldId}
        onSelect={select}
        provenance={provenance}
      />
      <RulesSection
        fields={report.fields}
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

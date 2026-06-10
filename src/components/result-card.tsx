'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tag, Accordion } from '@trussworks/react-uswds';
import { type ResultLine } from '@/lib/results/result-types';
import { RULES } from '@/lib/validation/engine';
import WarningDiff from './warning-diff';

interface Props {
  file: File;
  result: ResultLine | undefined;
}

export default function ResultCard({ file, result }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPending = !result;

  return (
    <div className="result-card bg-white border border-base-lighter radius-md padding-3 margin-bottom-2">
      <div className="display-flex flex-align-start">
        <div className="margin-right-3 flex-no-shrink">
          {thumbUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={thumbUrl}
              alt={`Preview of ${file.name}`}
              className="thumb"
              style={{
                width: 96,
                height: 96,
                objectFit: 'cover',
                borderRadius: 4,
                border: '1px solid #dfe1e2',
              }}
            />
          ) : (
            <div
              className="bg-base-lighter display-flex flex-align-center flex-justify-center"
              style={{ width: 96, height: 96, borderRadius: 4 }}
              aria-label="PDF — no preview"
            >
              <span className="font-sans-2xs text-base-darker">PDF</span>
            </div>
          )}
        </div>
        <div className="flex-fill">
          <div className="display-flex flex-justify flex-align-center margin-bottom-1">
            <strong className="font-sans-md">{file.name}</strong>
            <VerdictTag result={result} />
          </div>
          {isPending ? (
            <p className="font-sans-sm text-base margin-0" aria-busy="true">
              Checking…
            </p>
          ) : (
            <ResultBody result={result!} />
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictTag({ result }: { result: ResultLine | undefined }) {
  if (!result) {
    return (
      <Tag className="bg-base-lighter text-base-darker">In progress</Tag>
    );
  }
  if (result.status === 'error') {
    return <Tag className="bg-error-lighter text-error-darker">Error</Tag>;
  }
  if (result.report.overallStatus === 'compliant') {
    return <Tag className="bg-success text-white">Compliant</Tag>;
  }
  return <Tag className="bg-warning text-base-darkest">Needs review</Tag>;
}

function ResultBody({ result }: { result: ResultLine }) {
  const accordionItems = useMemo(() => buildAccordionItems(result), [result]);

  if (result.status === 'error') {
    return (
      <p className="font-sans-sm text-error-darker margin-0">
        {result.errorMessage}
      </p>
    );
  }

  return (
    <>
      <ul className="usa-list usa-list--unstyled margin-bottom-2">
        {RULES.map((rule) => {
          const field = result.report.fields[rule.id];
          if (!field) return null;
          return (
            <li
              key={rule.id}
              className="display-flex flex-align-center padding-y-05 border-bottom border-base-lighter"
            >
              <StatusIcon status={field.status} />
              <span className="margin-left-2 flex-fill">
                <strong className="font-sans-sm">{rule.label}</strong>
                <br />
                <span className="font-sans-2xs text-base-darker">
                  {field.extractedValue ?? 'Not detected'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <Accordion bordered items={accordionItems} />
      <p className="font-sans-3xs text-base margin-top-1 margin-bottom-0">
        Checked in {(result.durationMs / 1000).toFixed(1)}s.
      </p>
    </>
  );
}

function buildAccordionItems(result: ResultLine): Parameters<typeof Accordion>[0]['items'] {
  if (result.status !== 'ok') return [];
  const items: Parameters<typeof Accordion>[0]['items'] = [];
  const warningField = result.report.fields.governmentWarning;
  if (warningField && warningField.status !== 'pass') {
    items.push({
      id: `${result.filename}-warning-diff`,
      title: 'Why the Government Warning failed',
      content: (
        <div>
          <p className="font-sans-sm margin-top-0">{warningField.reason}</p>
          <WarningDiff extracted={warningField.extractedValue ?? null} />
        </div>
      ),
      expanded: false,
      headingLevel: 'h4',
    });
  }

  const otherFailures = Object.entries(result.report.fields).filter(
    ([id, f]) => id !== 'governmentWarning' && f.status !== 'pass',
  );
  if (otherFailures.length > 0) {
    items.push({
      id: `${result.filename}-other-issues`,
      title: 'Other issues',
      content: (
        <ul className="usa-list margin-bottom-0">
          {otherFailures.map(([id, f]) => {
            const rule = RULES.find((r) => r.id === id);
            return (
              <li key={id}>
                <strong>{rule?.label ?? id}:</strong>{' '}
                {f.reason ?? 'See extracted value above.'}
              </li>
            );
          })}
        </ul>
      ),
      expanded: false,
      headingLevel: 'h4',
    });
  }
  return items;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'pass') {
    return (
      <span
        className="bg-success-lighter text-success-darker radius-pill padding-x-1 font-sans-2xs"
        aria-label="Pass"
      >
        ✓
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span
        className="bg-error-lighter text-error-darker radius-pill padding-x-1 font-sans-2xs"
        aria-label="Fail"
      >
        ✗
      </span>
    );
  }
  return (
    <span
      className="bg-warning-lighter text-warning-darker radius-pill padding-x-1 font-sans-2xs"
      aria-label="Uncertain"
    >
      ?
    </span>
  );
}

'use client';

import { diffWarning } from '@/lib/diff/warning-diff';
import { GOVERNMENT_WARNING_CANONICAL } from '@/lib/validation/ttb-constants';

interface Props {
  extracted: string | null;
}

export default function WarningDiff({ extracted }: Props) {
  if (extracted === null) {
    return (
      <div className="bg-error-lighter padding-2 radius-sm">
        <p className="margin-0">
          No Government Warning was detected on this label. The full required
          text is shown below — it must appear on the label exactly:
        </p>
        <p className="font-mono-sm margin-top-2 margin-bottom-0 text-base-darker">
          {GOVERNMENT_WARNING_CANONICAL}
        </p>
      </div>
    );
  }

  const segments = diffWarning(GOVERNMENT_WARNING_CANONICAL, extracted);

  return (
    <div>
      <p className="font-sans-2xs text-base-darker margin-top-0 margin-bottom-1">
        Comparison against required TTB text. <strong className="bg-success-lighter padding-x-05">Green</strong> = matches; <strong className="bg-error-lighter padding-x-05">red</strong> = missing or different.
      </p>
      <pre className="font-mono-sm bg-base-lightest padding-2 radius-sm overflow-x-auto margin-0" aria-label="Warning text comparison">
        <code>
          {segments.map((seg, i) => {
            if (seg.kind === 'equal') return <span key={i}>{seg.text}</span>;
            if (seg.kind === 'missing')
              return (
                <span
                  key={i}
                  className="bg-error-lighter text-error-darker"
                  aria-label="Missing from label"
                >
                  {seg.text}
                </span>
              );
            return (
              <span
                key={i}
                className="bg-warning-lighter text-warning-darker text-strike"
                aria-label="Extra on label"
              >
                {seg.text}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

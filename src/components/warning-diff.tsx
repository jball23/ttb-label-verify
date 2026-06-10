'use client';

import { diffWarning } from '@/lib/diff/warning-diff';
import { GOVERNMENT_WARNING_CANONICAL } from '@/lib/validation/ttb-constants';

interface Props {
  extracted: string | null;
}

export default function WarningDiff({ extracted }: Props) {
  if (extracted === null) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          No Government Warning was detected on this label. The full required text:
        </p>
        <p className="mt-2 font-mono text-xs leading-relaxed text-foreground">
          {GOVERNMENT_WARNING_CANONICAL}
        </p>
      </div>
    );
  }

  const segments = diffWarning(GOVERNMENT_WARNING_CANONICAL, extracted);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="diff-missing inline-block size-2.5 rounded-[2px]" />
          Missing from label
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="diff-extra inline-block size-2.5 rounded-[2px]" />
          Extra / changed
        </span>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3 max-h-64 overflow-y-auto">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
          {segments.map((seg, i) => {
            if (seg.kind === 'equal') return <span key={i}>{seg.text}</span>;
            if (seg.kind === 'missing')
              return (
                <span key={i} className="diff-missing" aria-label="Missing from label">
                  {seg.text}
                </span>
              );
            return (
              <span key={i} className="diff-extra" aria-label="Extra on label">
                {seg.text}
              </span>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

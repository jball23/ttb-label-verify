'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { type Requirement } from '@/lib/labels/requirements';

/** An ⓘ button that explains what TTB requires for one item. Click or tap; Escape or clicking away closes it. */
export function RequirementInfo({ label, requirement }: { label: string; requirement: Requirement }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex">
      <button
        type="button"
        aria-label={`What is required: ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info aria-hidden className="size-4" />
      </button>
      {open ? (
        <span
          id={panelId}
          role="dialog"
          aria-label={`${label} requirement`}
          className="absolute left-0 top-8 z-30 flex w-80 max-w-[80vw] flex-col gap-2 rounded-lg border border-border bg-popover p-4 text-left text-sm text-popover-foreground shadow-lg"
        >
          <span className="font-semibold">{label}</span>
          <span>{requirement.summary}</span>
          {requirement.section ? <span className="text-muted-foreground">{requirement.section}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

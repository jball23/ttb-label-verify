'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DisclosureProps {
  title: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * A lightweight, accessible single-disclosure component for inline expansion.
 * Uses native button + aria-expanded; no extra dependencies.
 */
export function Disclosure({ title, defaultOpen = false, className, children }: DisclosureProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn('rounded-md border border-border bg-card/50', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent/50 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        className={cn(
          'grid transition-all duration-200',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1 text-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

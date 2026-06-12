'use client';

import { FileText, Image as ImageIcon, Layers } from 'lucide-react';
import { type SourceTab } from '@/lib/detail-view/select-field';
import { cn } from '@/lib/utils';

interface Props {
  active: SourceTab;
  available: Set<SourceTab>;
  onChange(tab: SourceTab): void;
}

const TABS: Array<{ key: SourceTab; label: string; icon: React.ReactNode }> = [
  { key: 'form', label: 'Form', icon: <FileText className="size-3.5" /> },
  { key: 'front', label: 'Front', icon: <ImageIcon className="size-3.5" /> },
  { key: 'back', label: 'Back', icon: <Layers className="size-3.5" /> },
];

/**
 * Three-button tab strip for the source viewer. All three buttons are
 * always rendered so the layout is stable across applications; disabled
 * buttons grey out when no page of that kind exists. Plan unit: U7.
 */
export default function SourceViewerTabs({ active, available, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Source pages"
      className="flex items-center gap-1 border-b border-border px-2 pb-1.5 pt-1"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const isAvailable = available.has(t.key);
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={!isAvailable}
            disabled={!isAvailable}
            onClick={() => onChange(t.key)}
            title={isAvailable ? `Show ${t.label}` : `${t.label} page not present`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : isAvailable
                  ? 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                  : 'cursor-not-allowed border-transparent text-muted-foreground/40',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

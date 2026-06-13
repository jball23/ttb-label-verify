'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import {
  Dropdown,
  DropdownContent,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import {
  DEMO_SCENARIOS,
  loadScenarioPdf,
} from '@/lib/application/load-scenario.client';
import { cn } from '@/lib/utils';

interface Props {
  onScenariosLoaded(pdfFiles: File[]): void;
  onError(message: string): void;
}

/**
 * Multi-select demo-scenario picker. The button opens a checkbox-style
 * dropdown of every COLA fixture under public/samples/cola/. Clicking an
 * item toggles selection without closing; the adjacent Verify button fetches
 * each selected scenario's PDF and hands them back to the queue as a batch.
 */
export default function ScenarioPicker({
  onScenariosLoaded,
  onError,
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const allSelected = selected.size === DEMO_SCENARIOS.length;
  const noneSelected = selected.size === 0;

  function toggle(slug: string): void {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function selectAll(): void {
    setSelected(
      allSelected ? new Set() : new Set(DEMO_SCENARIOS.map((s) => s.slug)),
    );
  }

  async function run(): Promise<void> {
    if (loading || noneSelected) return;
    setLoading(true);
    const slugs = Array.from(selected);
    try {
      const files = await Promise.all(slugs.map((s) => loadScenarioPdf(s)));
      onScenariosLoaded(files);
      setSelected(new Set());
    } catch (err) {
      onError(`Could not load demo scenarios: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const triggerLabel = useMemo(() => {
    if (loading) return 'Loading…';
    if (noneSelected) return 'Choose samples…';
    if (selected.size === 1) {
      const slug = Array.from(selected)[0];
      return DEMO_SCENARIOS.find((s) => s.slug === slug)?.label ?? '1 selected';
    }
    return `${selected.size} selected`;
  }, [loading, noneSelected, selected]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
      <div className="flex w-full flex-col items-center justify-center gap-2 sm:flex-row">
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Sparkles className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            Sample applications
          </span>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row">
          <Dropdown>
            <DropdownTrigger
              disabled={loading}
              aria-label="Choose sample applications"
              // Fixed width so the trigger never reflows as the label changes
              // ("Choose samples…" → "3 selected" → "Cointreau Spicy Margarita").
              className={cn(
                'w-full justify-between gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs sm:w-56',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <span className="truncate">{triggerLabel}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </DropdownTrigger>
            <DropdownContent
              align="start"
              className="max-h-[60vh] w-72 overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {selected.size}/{DEMO_SCENARIOS.length}
                </span>
              </div>
              <ul role="listbox" aria-multiselectable="true">
                {DEMO_SCENARIOS.map((scenario) => {
                  const isOn = selected.has(scenario.slug);
                  return (
                    <li key={scenario.slug}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isOn}
                        onClick={() => toggle(scenario.slug)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:outline-none',
                          isOn && 'text-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                            isOn
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background',
                          )}
                        >
                          {isOn && <Check className="size-2.5" />}
                        </span>
                        <span className="truncate">{scenario.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </DropdownContent>
          </Dropdown>
          <button
            type="button"
            onClick={run}
            disabled={loading || noneSelected}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md',
              'bg-primary px-3 text-xs font-medium text-primary-foreground',
              'hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {selected.size > 1 ? `Verify ${selected.size}` : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  DEMO_SCENARIOS,
  loadScenarioPdf,
} from '@/lib/application/load-scenario.client';

interface Props {
  onScenarioLoaded(pdfFile: File): void;
  onError(message: string): void;
}

export default function ScenarioPicker({ onScenarioLoaded, onError }: Props) {
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>): Promise<void> {
    const slug = e.target.value;
    if (!slug || loadingSlug) return;
    setLoadingSlug(slug);
    try {
      const pdfFile = await loadScenarioPdf(slug);
      onScenarioLoaded(pdfFile);
    } catch (err) {
      onError(`Could not load demo scenario: ${(err as Error).message}`);
    } finally {
      setLoadingSlug(null);
      e.target.value = '';
    }
  }

  const description = loadingSlug
    ? DEMO_SCENARIOS.find((s) => s.slug === loadingSlug)?.description
    : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        {loadingSlug ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Sparkles className="size-3.5 text-muted-foreground" />
        )}
        <label
          htmlFor="scenario-picker"
          className="text-xs font-medium text-muted-foreground"
        >
          Try a demo scenario
        </label>
        <select
          id="scenario-picker"
          onChange={onChange}
          disabled={loadingSlug !== null}
          defaultValue=""
          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          aria-label="Choose a demo scenario"
        >
          <option value="" disabled>
            Choose a scenario…
          </option>
          {DEMO_SCENARIOS.map((scenario) => (
            <option key={scenario.slug} value={scenario.slug}>
              {scenario.label}
            </option>
          ))}
        </select>
      </div>
      {description && (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          Loading: {description}
        </p>
      )}
    </div>
  );
}

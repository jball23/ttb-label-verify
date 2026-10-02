'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useBatch } from './batch-provider';

/** Test labels covering the brief's scenarios (see evals/cases.ts). Served from /public. */
const SAMPLE_LABELS = [
  'old-tom-bourbon.jpg',
  'old-tom-title-case-warning.jpg',
  'old-tom-reworded-warning.jpg',
  'old-tom-glare-angle.jpg',
  'stones-throw-gin.jpg',
  'ridge-creek-bourbon.jpg',
  'silver-birch-vodka.jpg',
  'hawthorne-cabernet.jpg',
  'ironwood-ipa-no-warning.jpg',
  'calypso-rum-proof-only.jpg',
];

export function SampleLabelsButton() {
  const { addFiles } = useBatch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const files = await Promise.all(
        SAMPLE_LABELS.map(async (name) => {
          const response = await fetch(`/samples/labels/${name}`);
          if (!response.ok) throw new Error(name);
          return new File([await response.blob()], name, { type: 'image/jpeg' });
        }),
      );
      addFiles(files);
    } catch {
      setError('The sample labels could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="lg" className="text-base" onClick={load} disabled={loading}>
        {loading ? 'Loading samples…' : `Try ${SAMPLE_LABELS.length} sample labels`}
      </Button>
      {error ? <span className="text-base text-status-problem">{error}</span> : null}
    </>
  );
}

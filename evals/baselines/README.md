# Baselines

Snapshots of extractor performance against the 20 real TTB COLA Online exports under `public/samples/cola/`. Captured before a pipeline change so we can validate parity after.

## Format

Each baseline is a JSON file produced by a capture script. Schema:

```ts
{
  capturedAt: string;             // ISO 8601 timestamp
  extractProvenance: boolean;     // whether bbox/provenance was requested
  entries: BaselineEntry[];       // one per PDF in the samples dir
  summary: {
    totalPdfs: number;
    successCount: number;
    errorCount: number;
    meanRenderLatencyMs: number;
    meanExtractionLatencyMs: number;
    meanTotalLatencyMs: number;
  };
}

interface BaselineEntry {
  filename: string;
  sizeBytes: number;
  pages: Array<{ pageNumber: number; kind: string; pngSizeBytes: number }>;
  extractionLatencyMs: number;
  renderLatencyMs: number;
  totalLatencyMs: number;
  modelId: string;
  providerName: string;
  promptVersion?: string;
  extraction?: ExtractedDocument;  // full extractor output
  errorMessage?: string;
}
```

## Current snapshots

| File | Pipeline | Provenance | Notes |
|------|----------|------------|-------|
| `2026-06-11-gpt4o-cola.json` | OpenAI `gpt-4o-2024-11-20` | on | Pre-Tesseract baseline. The U5 parity gate diffs the Tesseract output against this snapshot to enforce the ±5% accuracy floor and the latency target from `docs/plans/2026-06-11-001-feat-tesseract-bbox-detail-view-plan.md`. |

## Re-capturing

Snapshots are frozen by design — they represent "this is the pipeline's behavior at this moment, against this dataset." Re-run only when:

- The samples dir changes (add/remove PDFs).
- The baseline pipeline itself changes (model swap, prompt rev) and you want a new floor.

```bash
# Re-capture the GPT-4o snapshot (requires OPENAI_API_KEY; ~$0.50-1.50)
npx tsx scripts/baseline-capture.ts
```

The capture forces `EXTRACT_PROVENANCE=true` regardless of `.env.local`, so the snapshot always contains the model's bboxes when present.

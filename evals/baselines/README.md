# Baselines

> Historical measurement note: these snapshots were captured during the
> GPT-4o-to-Tesseract extraction pivot. They are useful for comparison history,
> but they are not the current deploy gate; use the root `README.md` testing
> section for current merge checks.

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
| `2026-06-11-gpt4o-cola.json` | OpenAI `gpt-4o-2024-11-20` | on | Pre-Tesseract baseline used during the OCR pivot. |

## Re-capturing

Snapshots are frozen by design — they represent "this is the pipeline's behavior at this moment, against this dataset." Re-run only when:

- The samples dir changes (add/remove PDFs).
- The baseline pipeline itself changes (model swap, prompt rev) and you want a new floor.

```bash
# Re-capture the GPT-4o snapshot (requires OPENAI_API_KEY; ~$0.50-1.50)
npx tsx scripts/baseline-capture.ts
```

The capture forces `EXTRACT_PROVENANCE=true` regardless of `.env.local`, so the snapshot always contains the model's bboxes when present.

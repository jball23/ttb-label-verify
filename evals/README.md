# Evals

We treat the LLM as a versioned dependency we measure, not a magic box. This suite catches model upgrades, prompt drift, and provider swaps that silently regress extraction quality.

## Run

```bash
npm run eval
```

Requires `OPENAI_API_KEY` in `.env.local`. Posts traces + scores to Langfuse when those keys are set; runs locally otherwise.

## What's in the dataset

Five hand-curated cases at `evals/dataset/`:

| Case | What it tests |
|------|--------------|
| `compliant-bourbon` | Fully-compliant label — baseline that should score 1.0 across the board |
| `missing-warning` | Government Warning absent — model must return null, not invent text |
| `wrong-abv-format` | ABV stated as "forty percent alcohol" — extractor returns it verbatim, the rule engine rejects the format |
| `partial-extraction` | Producer + country missing (back label not photographed) — model must return null, not invent |
| `edge-case-foreign-import` | Imported Scotch with "IMPORTED BY" — non-US producer + country drift test |

Each case has:
- A real label image at `evals/dataset/images/<id>.jpg`
- Ground-truth `ExtractedFields` JSON

**Note on images:** The dataset JSONs are committed, but the actual label images at `evals/dataset/images/` need to be sourced before `npm run eval` will produce results. The eval runner skips and reports cases with missing images cleanly. See `evals/dataset/images/README.md` for sourcing guidance.

## Evaluators

Two scorers, both pure functions, both tested:

**`field-extraction-accuracy`** — per-field precision over the 6 string fields. Each field scores 0 or 1; aggregate is the mean. Hallucinations (expected null, got value) and misses (expected value, got null) both score 0. Skips the Government Warning text (dedicated evaluator below).

**`government-warning-match`** — binary exact-match on the warning text after whitespace normalization. Case-sensitive (the "GOVERNMENT WARNING:" prefix must be in all caps per 27 CFR §16.21).

## CI gate

`npm run eval` exits non-zero if:
- Aggregate field-accuracy < **0.85** across all cases
- Warning-match pass rate < **1.0** (warning is high-stakes — must be exact)

If you intentionally change the expected values, do it in a single commit that updates the JSON files explicitly. The diff is the record.

## Adding a case

1. Add an image at `evals/dataset/images/<your-id>.jpg`
2. Add a JSON next to it at `evals/dataset/<your-id>.json` matching the schema
3. Import it in `evals/dataset/index.ts` and add to `RAW_CASES`
4. Run `npm run eval` to verify

## What this does NOT cover

- Visual styling (bold, all-caps) — the model's judgment fields are surfaced but not scored, because vision LLMs are weak at typography and we're not pretending otherwise
- Multi-page PDFs
- Languages other than English on labels
- Image quality degradation (rotation, blur, low resolution) — would be a Phase 2 hardening pass

These are honest limitations, not oversights.

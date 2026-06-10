# Demo dataset — COLA applications + labels

Five fictitious `TTB F 5100.31` applications paired with the labels that would be submitted alongside them. Each scenario exercises a specific failure mode in the verify pipeline so the demo shows a full range of TTB-reviewer outcomes, not just the green-path bourbon.

## Why this exists

The current prototype validates a label image against the six TTB labeling rules in isolation. In reality, a TTB reviewer looks at **the COLA application AND the submitted labels together** and verifies that the labels match what the applicant certified on the form. This dataset is the input for that cross-check feature.

Each scenario folder contains:

- `application.json` — the filled-out COLA form (TTB F 5100.31), structured as the system will ingest it. Includes `crossCheckExpectations`, `labelOnlyExpectations`, `intentionalMismatches`, and `expectedVerdict` so it doubles as a fixture for the eval harness.
- `label-prompt.md` — the prompt to paste into Google Nano Banana, OpenAI `gpt-image-1`, or another image-gen tool to produce the corresponding `label.jpg`. Each prompt encodes the scenario's intentional mismatches verbatim.
- `label.jpg` — *not yet generated.* Drop the image-gen output here once produced.

## Scenario truth table

| # | Slug | Product type | Cross-check failures | Label-only rule failures | Expected verdict |
|---|------|--------------|----------------------|---------------------------|------------------|
| 1 | `01-ridge-creek-bourbon` | Distilled Spirits | — | — | **COMPLIANT** |
| 2 | `02-silver-birch-vodka` | Distilled Spirits | brand name drift ("Silver Birch" vs "Silver Birch Premium") | — | NEEDS_REVIEW |
| 3 | `03-hawthorne-cabernet` | Wine | varietal (Cab Sauv → Merlot) + appellation (Napa → Sonoma) | — | NEEDS_REVIEW |
| 4 | `04-ironwood-ipa` | Malt Beverage | — | Government Warning missing | NEEDS_REVIEW |
| 5 | `05-calypso-rum` | Distilled Spirits | producer mismatch (different bottler entity) | ABV shown as "80 PROOF" only, no % ABV | NEEDS_REVIEW |

Coverage:
- All three product types (wine, distilled spirits, malt beverage)
- A clean pass, a cross-check-only failure, a label-only failure, and a combined failure
- Both wine-only fields (varietal + appellation) exercised in scenario 3

## Field mapping (form Item → label / extracted field)

| COLA Form Item | Label field | Schema field on `ExtractedFields` |
|----------------|-------------|------------------------------------|
| Item 5 — Type of product | Class/type designation | `classType` |
| Item 6 — Brand Name (required) | Brand mark | `brandName` |
| Item 7 — Fanciful Name (if any) | Fanciful name / product line | (part of `classType` or absent on label) |
| Item 8 — Applicant name + address | Producer/bottler statement | `producer` |
| Item 10 — Grape Varietal (wine only) | Varietal designation | (cross-check only — not on `ExtractedFields` yet) |
| Item 11 — Wine Appellation (wine only) | Appellation | (cross-check only — not on `ExtractedFields` yet) |

Form items 1–4, 9, 12–13, 14, 16–18 are administrative — they do not appear on a label and are not cross-checked.

Label-only fields (verified by existing TTB rules in `src/lib/validation/rules/`, no application counterpart):

- `abv` — required `% alcohol by volume` figure (rules/abv.ts)
- `netContents` — declared net contents (rules/net-contents.ts)
- `governmentWarning` — verbatim 27 CFR §16 warning (rules/government-warning.ts)

## Generating the label images

For each scenario folder:

1. Open `label-prompt.md`
2. Paste the prompt block into your image-gen tool of choice (Nano Banana, gpt-image-1, ChatGPT image)
3. Save the result as `label.jpg` in the same folder
4. Run the verification checklist at the bottom of the prompt — every intentional mismatch must be present and every other field must be correct. If the image-gen tool auto-corrects an intentional mismatch (e.g. inserts a missing Government Warning), regenerate with an even more explicit instruction.

The prompts are tuned for flat unrolled label artwork (not 3D bottle photos) so OCR is clean. Backgrounds are neutral light-gray studio surfaces so the extractor isn't distracted by scene content.

## What the verify pipeline will do with this dataset (proposed)

Once the application + label cross-check feature ships, the verify endpoint will accept both inputs and produce a result with three sections per scenario:

1. **Extraction** — what the label extractor found
2. **Cross-check** — field-by-field comparison of `application.crossCheckExpectations` vs extracted fields, one row per field with `match` / `mismatch` / `not_on_label`
3. **Label-only rules** — existing six TTB rules, unchanged

The aggregate verdict combines both — `COMPLIANT` only if cross-check is all matches AND all label-only rules pass.

## Once the system is wired up

`expectedVerdict` and `intentionalMismatches` are designed to drive eval cases — each scenario doubles as a regression fixture. A future `npm run eval` should iterate `public/samples/applications/`, run the full pipeline against each `(application.json, label.jpg)` pair, and assert the verdict + mismatch list matches what's declared in the JSON.

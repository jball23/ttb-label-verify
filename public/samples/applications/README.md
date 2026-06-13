# Demo dataset — COLA applications + labels

> Legacy fixture note: the live app now verifies real COLA PDFs from
> `public/samples/cola/` and user-uploaded Form 5100.31 PDFs. These synthetic
> `application.json` + label-image scenarios are retained for historical route
> tests and should not be treated as the current product flow.

Five fictitious `TTB F 5100.31` applications paired with the labels that would be submitted alongside them. Each scenario exercises a specific failure mode in the verify pipeline so the demo shows a full range of TTB-reviewer outcomes, not just the green-path bourbon.

## Why this exists

This dataset was created before the real-PDF workflow, when the prototype used
structured `application.json` fixtures plus generated label images to design
the application/label cross-check feature. The current app performs that review
from one uploaded COLA PDF instead.

Each scenario folder contains:

- `application.json` — the filled-out COLA form (TTB F 5100.31), structured as the system will ingest it. Includes `crossCheckExpectations`, `labelOnlyExpectations`, `intentionalMismatches`, and `expectedVerdict` so it doubles as a fixture for the eval harness.
- `label-prompt.md` — the prompt to paste into Google Nano Banana, OpenAI `gpt-image-1`, or another image-gen tool to produce the corresponding `label.jpg`. Each prompt encodes the scenario's intentional mismatches verbatim.
- `label.jpg` — _not yet generated._ Drop the image-gen output here once produced.

## Scenario truth table

| #   | Slug                     | Product type      | Cross-check failures                                        | Label-only rule failures               | Expected verdict |
| --- | ------------------------ | ----------------- | ----------------------------------------------------------- | -------------------------------------- | ---------------- |
| 1   | `01-ridge-creek-bourbon` | Distilled Spirits | —                                                           | —                                      | **COMPLIANT**    |
| 2   | `02-silver-birch-vodka`  | Distilled Spirits | brand name drift ("Silver Birch" vs "Silver Birch Premium") | —                                      | NEEDS_REVIEW     |
| 3   | `03-hawthorne-cabernet`  | Wine              | varietal (Cab Sauv → Merlot) + appellation (Napa → Sonoma)  | —                                      | NEEDS_REVIEW     |
| 4   | `04-ironwood-ipa`        | Malt Beverage     | —                                                           | Government Warning missing             | NEEDS_REVIEW     |
| 5   | `05-calypso-rum`         | Distilled Spirits | producer mismatch (different bottler entity)                | ABV shown as "80 PROOF" only, no % ABV | NEEDS_REVIEW     |

Coverage:

- All three product types (wine, distilled spirits, malt beverage)
- A clean pass, a cross-check-only failure, a label-only failure, and a combined failure
- Both wine-only fields (varietal + appellation) exercised in scenario 3

## Field mapping (form Item → label / extracted field)

| COLA Form Item                         | Label field                  | Schema field on `ExtractedFields`                 |
| -------------------------------------- | ---------------------------- | ------------------------------------------------- |
| Item 5 — Type of product               | Fanciful name                | `classType`                                       |
| Item 6 — Brand Name (required)         | Brand mark                   | `brandName`                                       |
| Item 7 — Fanciful Name (if any)        | Fanciful name / product line | (part of `classType` or absent on label)          |
| Item 8 — Applicant name + address      | Producer/bottler statement   | `producer`                                        |
| Item 10 — Grape Varietal (wine only)   | Varietal designation         | `wineVarietal`                                    |
| Item 11 — Wine Appellation (wine only) | Appellation                  | `wineAppellation`                                 |

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

## What the original proposed pipeline did with this dataset

The original plan for these fixtures was a two-input verify endpoint that
accepted both `application.json` and `label.jpg` and produced:

1. **Extraction** — what the label extractor found
2. **Cross-check** — field-by-field comparison of `application.crossCheckExpectations` vs extracted fields, one row per field with `match` / `mismatch` / `not_on_label`
3. **Label-only rules** — existing six TTB rules, unchanged

The aggregate verdict combines both — `COMPLIANT` only if cross-check is all matches AND all label-only rules pass.

## Current use

`expectedVerdict` and `intentionalMismatches` still explain the old regression
intent, but the live verifier no longer runs these folders as user-facing demo
scenarios. The route tests keep them only as deterministic historical fixtures.

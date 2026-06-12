---
title: "feat: Tesseract.js OCR extractor + bbox-driven detail view"
type: feat
status: active
created: 2026-06-11
origin: docs/brainstorms/2026-06-11-tesseract-bbox-requirements.md
branch: feat/tesseract-bbox
---

# feat: Tesseract.js OCR extractor + bbox-driven detail view

## Problem Frame

Two real complaints with the current extraction + detail-view experience (see origin: `docs/brainstorms/2026-06-11-tesseract-bbox-requirements.md`):

1. **GPT-4o vision dominates the ~10–15s budget per PDF, and provenance/bbox quality from the model was poor enough that the prior session disabled `EXTRACT_PROVENANCE` by default.** The reviewer can read "Read: 5.17 gal" on the Net Contents row but has no way to point at where on the label that text actually lives.
2. **The detail page hides the PDF behind a modal.** With no always-visible source of truth alongside the extracted values, the reviewer can't visually verify what the AI read.

This plan swaps to **Tesseract.js as the primary extractor** with **per-word bboxes + confidence** falling out of the API, a **VLM (gpt-4o) fallback** for fields Tesseract can't handle (no bbox in fallback path), and **redesigns `/applications/[id]`** into a 50/50 split with a zoomable PDF/label viewer on the right that highlights bboxes when the reviewer clicks an extracted field on the left. Finalize controls move from a sidebar card to the page header.

---

## Scope Boundaries

### In scope
- New Tesseract.js OCR module + WASM bundling in the Vercel `/api/verify` lambda.
- New extractor that runs Tesseract first, assigns words to canonical fields (form + label), and triggers per-field VLM fallback when confidence is low or no match is found.
- Replacement of `EXTRACT_PROVENANCE` flag and the GPT-4o provenance prompt path with the new bbox source.
- Baseline capture of current GPT-4o-only field-extraction accuracy on the 20 cola samples so the ±5% parity gate has something to measure against.
- New `/applications/[id]` layout: 50/50 split, tabbed right pane (`[Form][Front][Back]`, always visible, greyed when empty), zoomable + pannable viewer, click-to-bbox routing.
- Finalize panel moved to the page header (top-right). "View full PDF" button + modal deleted.

### Deferred to Follow-Up Work
- Image preprocessing pipeline (binarization, deskew, denoise) beyond Tesseract defaults.
- Adaptive landmark-based form-field extraction (v1 uses hand-tuned region rects; adaptive is the v2 fallback if real exports vary more than expected).
- Tesseract language packs beyond English.
- "Re-OCR this field" reviewer action when a bbox is visibly wrong.
- Visual confidence indicator on the bbox itself (color border by Tesseract confidence band).
- Persisting rendered page PNGs in DB so the detail view doesn't re-render on every load.

### Outside this product's identity
- COLAs system integration.
- Roboflow / supervision / custom detection model training.
- Python sidecar services.

---

## Requirements Traceability

Carried from origin doc:

| Requirement | Origin section | Resolved in |
|---|---|---|
| Every extracted field is clickable; Tesseract fields render a bbox, VLM-fallback fields surface "source not available" | Goals / Success criteria | U7, U8 |
| Field-extraction accuracy within ±5% of GPT-4o baseline on 20 cola samples | Success criteria | U1 (baseline), U5 (parity gate) |
| End-to-end verify time ≤ current `EXTRACT_PROVENANCE=false` path | Success criteria | U2 (spike measures), U5 (parity gate) |
| Per-verify cost ≥80% lower | Success criteria | U4 (Tesseract is free; VLM only on fallback) |
| 50/50 detail-page split, both panels fit 1440×900 | Success criteria | U6, U7 |
| Zoom + pan on PDF and label images | Success criteria | U7 |
| `[Form][Front][Back]` tabs always visible, greyed when empty | Detail page redesign | U7 |
| Click extracted field → switch tab + highlight bbox (Tesseract) or render "source not available" (VLM fallback) | Detail page redesign | U8 |
| Finalize moves to page header; "View full PDF" disappears | Detail page redesign | U9 |
| VLM-fallback fields show "source not available" | Detail page redesign | U8 |
| Delete `EXTRACT_PROVENANCE` flag + GPT-4o provenance code | In scope | U4 |
| Vercel lambda includes Tesseract WASM + `eng.traineddata` | Dependencies | U3, U10 |

---

## Key Technical Decisions

### KD1. Form-side OCR strategy: full-page OCR + bbox-containment field assignment
> **Revised 2026-06-11 after U2 spike.** The previous version of KD1 called for 18 separate region crops, each `worker.recognize()`-ed individually. The Tesseract.js spike (`scripts/spike-output/findings.md`) showed that a single full-page OCR returns every word with its own bbox in ~2.5s for the form page, with mean confidence 92. Region-by-region cropping would have cost 18× the per-call setup overhead AND would have lost cross-region context (an item value that bleeds across a printed rect boundary still gets caught by the full-page pass). The doc-review's scope-guardian flagged this; the spike confirmed it.

One Tesseract pass per rendered page returns the complete word list with bboxes. The form-side assigner then filters words by **bbox containment** within the TTB Form 5100.31 item rectangles (Item 1: serial number, Item 7: fanciful name, etc.) and assembles each item's text by reading-order sort. Pure function over the word list — no second OCR pass.

Trade-off: still fragile to non-standard exports if the form layout shifts (different form versions, scanned vs digital — the item rects are coordinates at 200 DPI against TTB Form 5100.31 06-2016). Mitigation: the VLM fallback catches anything the rect-containment path misses. Adaptive (landmark-relative) extraction is deferred to v2.

### KD2. Per-field bbox shape: list of word rects
Each extracted field stores a list of `{x, y, w, h, confidence, text}` per matched word, not a single union rect. The Government Warning spans multiple lines on real labels and would render as one huge box covering decorative artwork between its tokens if we used union rects. List-of-word-rects lets the overlay component render N tight highlights that hug the actual glyphs.

Trade-off: slightly more data per field, slightly more render work. Acceptable.

### KD3. VLM fallback: per-field, single-call
For each field where Tesseract returned no match or confidence below threshold, make one VLM call asking for *just that field's value*. No bbox in the response. Simpler to reason about + easier to debug than batched per-page calls. Fallbacks should be rare on consistent exports.

Trade-off: more API calls if many fields fall back. If profiling shows fallback density is high, batched-per-page is a v2 optimization.

### KD4. Tesseract confidence threshold for fallback: 60 (v1 default, tuned in U5)
Tesseract returns 0–100 confidence per word. Initial threshold for "trigger fallback" is **<60 mean confidence across the words assigned to a field**, OR **zero words assigned**. The threshold is recorded in `src/lib/ocr/config.ts` so it can be tuned against the 20 cola samples during U5 baseline parity validation without code-touching downstream paths.

### KD5. Single shared selection state at the page level
The click-to-bbox routing uses one `selectedField: { fieldPath: FieldPath, source: 'form' | 'front' | 'back', words: WordRect[] | null } | null` state owned by the `/applications/[id]` page. **`FieldPath` is the existing typed key** (`'application.brandName'`, `'label.governmentWarning.text'`, etc.) already used by `src/components/report-sections.tsx`. The new system stays on FieldPath — no parallel `fieldId` namespace, no string-vs-typed-key conversion layer. `SideRow`'s two clickable buttons remain — clicking the application-side row selects the form-side bbox, clicking the label-side row selects the label-side bbox. `words: null` signals VLM-fallback fields (UI renders the "source not available" overlay). Left panel rows are clickable and dispatch `onSelect(fieldPath)`; right panel viewer subscribes to `selectedField`. No global store needed; React `useState` + props.

### KD6. Replace, don't dual-run
The new Tesseract extractor *replaces* the GPT-4o provenance code path entirely. No feature flag for parallel pipelines, no `EXTRACT_PROVENANCE`. One source of truth for bboxes. The risk this incurs (regression on label quality if Tesseract underperforms) is gated by U5 (baseline parity) before any merge.

### KD7. Tesseract.js worker init: lazy + cached, single instance, sequential OCR
Tesseract.js's `createWorker('eng')` loads `eng.traineddata` (~10 MB) on first call. Cache the worker instance at module scope so each `/api/verify` request after the first reuses it; Vercel lambdas reuse warm instances across requests. Cold start adds ~500ms (measured) on the spike, much less than the ~10 MB filesize suggests.

**Single-worker sequential OCR is the v1 model.** `worker.recognize()` queues internally — concurrent calls on one worker serialize. The spike measured Bouchard at ~3.6s total for 4 pages of sequential OCR (form 2.5s + label 1.0s + label 0.4s + label 0.9s), well under the current GPT-4o baseline of ~21s for the same file. Provisioning two workers to run form + label in parallel would shave maybe 2s but doubles the `eng.traineddata` memory footprint and the cold-start cost. Deferred unless U5 surfaces a latency regression.

Tesseract API note: use `worker.recognize(image, {}, { blocks: true, text: true })` — the top-level convenience `Tesseract.recognize(image)` does not return the blocks > paragraphs > lines > words hierarchy needed for per-word bboxes in v6.

### KD8. Renderer Front/Back distinction via `Image Type:` markers
The current `src/lib/pdf/render.ts` page classifier emits only `kind: 'form' | 'label' | 'form+label'` — no Front/Back distinction. The U2 spike found that real COLA exports follow a stable pattern: a form page contains the text marker `"Image Type: Brand (front) or keg collar"` and the actual front-label artwork is on the **next** page; the form contains `"Image Type: Back"` and the back-label artwork follows. The classifier needs to detect those text markers and tag the **following** page as `'label-front'` / `'label-back'`. Pages containing the markers themselves are form chrome — kept as `'form'`.

Resolves doc-review decision D1. See U11 for the implementation.

### KD9. DB migration for archived `validation_report.provenance`: graceful degradation
Existing `applications.validation_report` jsonb rows carry the old shape — `provenance: ProvenanceMap` keyed by field path. After the swap, the new shape carries per-field `words: WordRect[]` instead. Rather than a destructive migration:
- New writes use the new shape unconditionally.
- The detail-view loader at `src/app/(app)/applications/[id]/page.tsx` detects shape: if `report.fields[id].words` is missing and `report.provenance` is present, render the archive view as read-only (no click-to-bbox interactivity) with a banner: "This application was verified before the Tesseract pipeline shipped — re-verify to enable source highlighting."
- No data backfill. No destructive migration. The shape divergence narrows naturally as users re-verify or as old records age out via the archive lifecycle.

Resolves doc-review decision D2.

---

## System-Wide Impact

- **`/api/verify` route handler:** payload shape changes — `provenance` field on the result line is replaced by per-field `words: WordRect[] | null` (null = VLM fallback). NDJSON stream contract Zod validator at `src/lib/results/result-types.ts` must update in lock-step or the client rejects every line.
- **DB persistence:** `applications.validation_report` jsonb column stops carrying `provenance`. **No destructive migration** — the loader detects shape and falls back to read-only archive rendering on old-shape rows (KD9). The shape divergence narrows naturally as users re-verify.
- **Page classifier (`src/lib/pdf/render.ts`):** `RenderedPage.kind` union grows from `'form' | 'label' | 'form+label'` to include `'label-front'` and `'label-back'` (KD8 / U11). Existing single-page synthetic fixtures use `'form+label-front'`.
- **Detail-view consumers:** `report-sections.tsx`, `detail-report-view.tsx`, `finalize-form.tsx`, `pdf-viewer.tsx`, `pdf-modal.tsx`, `queue-page.tsx` all touched. `pdf-modal.tsx` is deleted. `public/pdf.worker.min.mjs` stays in place — react-pdf still needs it on the client viewer; only the modal goes.
- **Vercel lambda bundle:** Tesseract WASM (~3 MB) + `eng.traineddata` (~10 MB) + tesseract.js worker script + WASM wrappers added to `/api/verify` via `outputFileTracingIncludes` — same pattern as the pdfjs worker fix today, but the include list is longer than just two files (see U3 file list).
- **Cost surface:** extraction cost drops from ~$0.02–0.05 per verify to near-zero for Tesseract-handled fields; only fallback fields pay LLM cost. Vercel function CPU-seconds rise modestly (Tesseract is CPU-bound).
- **Latency surface:** single-worker sequential OCR per page (KD7); measured at ~3.6s total for a 4-page export in U2 spike vs ~17s mean GPT-4o baseline. Real win.
- **Tests:** ~5 new test files; existing extraction + render tests retarget the new module + new kind tags.

---

## Implementation Units

### U1. Capture GPT-4o baseline accuracy + latency on 20 cola samples

**Goal:** Snapshot the current pipeline's field-extraction accuracy and end-to-end latency on every PDF in `public/samples/cola/`, so the ±5% parity gate in U5 has a real baseline to compare to.

**Requirements:** Success criteria — accuracy parity gate; latency floor.

**Dependencies:** None.

**Files:**
- `scripts/baseline-capture.ts` — new
- `evals/baselines/2026-06-11-gpt4o-cola.json` — new, output artifact
- `evals/baselines/README.md` — new, explains the baseline format

**Approach:**
Iterate over every PDF in `public/samples/cola/`. For each: read into buffer, call existing `extractApplication()` (or whatever the current entry point is) with `EXTRACT_PROVENANCE=true` for fair comparison, capture: `{ filename, extractedFields, latencyMs, llmTokens, verdict }`. Write to JSON keyed by filename. Skip the rule-engine — we want extraction accuracy, not verdict.

Run this script once and commit the JSON. It's a frozen reference.

**Patterns to follow:** the existing `evals/run.ts` runner shows how to iterate samples and call the extractor.

**Test scenarios:**
- Test expectation: none — this is a data-capture script, not a tested unit. Verification is "JSON written with 20 entries, each containing the expected fields."

**Verification:**
- `evals/baselines/2026-06-11-gpt4o-cola.json` exists with 20 entries.
- Each entry has non-empty `extractedFields` (or a structured failure record).
- Mean and per-sample latency are recorded.

---

### U2. Tesseract.js spike against one real cola PDF

**Goal:** De-risk the core assumption — that Tesseract.js, run server-side on a 200 DPI rendered TTB form/label page, reads enough fields with high enough confidence to be the primary extractor. Learn the API shape. Inform U4's word-grouping logic.

**Requirements:** Goals — extraction quality on par with GPT-4o.

**Dependencies:** None (parallel with U1; spike doesn't need baseline).

**Files:**
- `scripts/tesseract-spike.ts` — new, throwaway script
- `scripts/spike-output/` — new dir for visual outputs (annotated PNGs)

**Approach:**
Pick one representative real cola PDF (e.g., `26083001000522-chacewater.pdf` — a multi-page export). Render its pages via existing `renderApplicationPages()`. Feed each PNG to Tesseract.js. Dump:
- The full word list with per-word `{text, bbox, confidence}`.
- An annotated PNG with bboxes overlaid (use `canvas` or `sharp` to draw rects).
- A grouped-by-line view to inform multi-line field assignment.

Manually inspect: can we see the brand name, ABV, Government Warning, net contents? At what confidences?

The spike output isn't merged into the product; it informs U4's region rects, KD2's word-grouping algorithm, and KD4's confidence threshold default.

**Patterns to follow:** `src/lib/pdf/render.ts` for rendering; the Tesseract.js README for the API.

**Test scenarios:**
- Test expectation: none — spike script, throwaway.

**Verification:**
- `scripts/spike-output/<filename>-form-annotated.png` and `<filename>-label-annotated.png` visible to the developer.
- The brand name, ABV, and Government Warning text are recognizable in the Tesseract output with confidence ≥ 60.
- Developer can articulate which fields will likely need VLM fallback (write findings to `scripts/spike-output/findings.md`).

---

### U3. Add Tesseract.js to the project + Vercel WASM bundling

**Goal:** Install Tesseract.js as a dependency, configure the Next.js + Vercel lambda to ship the WASM + `eng.traineddata` files, and add a lazy-cached worker module.

**Requirements:** Dependencies — Tesseract WASM + `eng.traineddata` in lambda bundle.

**Dependencies:** None (can run in parallel with U1, U2).

**Files:**
- `package.json` — add `tesseract.js`
- `next.config.mjs` — add `tesseract.js`, `tesseract.js-core`, and any `.wasm`/`.traineddata` paths to `outputFileTracingIncludes['/api/verify']`
- `src/lib/ocr/worker.ts` — new, module-scoped cached `createWorker()`
- `src/lib/ocr/worker.test.ts` — new

**Approach:**
`npm install tesseract.js`. Tesseract.js ships `tesseract-core.wasm`, `worker.min.js`, and language data files in `node_modules/tesseract.js-core/` and `node_modules/tesseract.js/`. Like the pdfjs worker fix (`fix(vercel): force-include pdfjs worker + fonts in /api/verify bundle`), Vercel's nft can't trace these runtime-resolved files. Add them to `outputFileTracingIncludes`.

`worker.ts` exports `getWorker(): Promise<Tesseract.Worker>` that creates a worker on first call and caches it at module scope. Wrap `recognize(image)` in `runOcr(image): Promise<OcrResult>` that returns `{ words: { text, bbox, confidence }[] }`.

Wire the worker init to load from a filesystem path computed via `path.join(process.cwd(), 'node_modules', 'tesseract.js-core', '...')` — same dodge as the pdfjs worker, since we have `outputFileTracingIncludes` covering the file list.

**Patterns to follow:** `src/lib/pdf/render.ts` for the `process.cwd() + path.join(...)` pattern; `next.config.mjs` for the existing `outputFileTracingIncludes` block.

**Test scenarios:**
- **Worker init returns a usable worker.** `getWorker()` resolves, `worker.recognize(testPngBuffer)` returns a result with at least one word.
- **Worker is cached.** Two calls to `getWorker()` return the same instance.
- **Recognize returns word-level bboxes and confidences.** On a synthetic test PNG of the text "TEST 123", every word has `bbox = {x0, y0, x1, y1}` numeric values and `confidence` in [0, 100].

**Verification:**
- `npm run build` succeeds.
- `.next/server/app/api/verify/route.js.nft.json` lists `tesseract-core.wasm` and `eng.traineddata`.
- Unit tests in `src/lib/ocr/worker.test.ts` pass.

---

### U11. Extend page classifier to distinguish front-label and back-label artwork

**Goal:** Update `src/lib/pdf/render.ts` so the page classifier emits `'label-front'` and `'label-back'` for the actual artwork pages, separating them from form chrome pages that merely contain `"Image Type:"` markers. Without this, U4's field assigner can't tell which side of the label a word came from, and U7's `[Form][Front][Back]` tabs don't know which page to display in each tab. Added 2026-06-11 after the U2 spike confirmed D1 as a real renderer change, not a docs tweak.

**Requirements:** KD8. Resolves doc-review decision D1.

**Dependencies:** U2 (spike findings inform the marker detection).

**Files:**
- `src/lib/pdf/render.ts` — modify; extend `PageClassification` + `pickPagesToRender` + the `RenderedPage.kind` union
- `src/lib/pdf/render.test.ts` — modify; add cases against the chacewater + bouchard cola fixtures

**Approach:**
- Extend the existing `PageClassification` with two new flags: `hasFrontImageMarker` (line text includes `"Image Type: Brand (front)"` or `"Image Type: Brand"` or `"or keg collar"`) and `hasBackImageMarker` (line text includes `"Image Type: Back"`).
- In `pickPagesToRender`, after the form page is chosen, walk pages in order. Each time a page carries `hasFrontImageMarker`, tag the **next** page as `'label-front'`. Each time a page carries `hasBackImageMarker`, tag the **next** page as `'label-back'`. The marker-bearing pages themselves stay tagged as form chrome — they're not surfaced as a viewer tab.
- If a marker has no following page (rare — multi-back-label exports where the marker is on the last page), tag the marker page itself.
- If a single page carries both Front and Back markers (a tightly-packed export), the following two pages get `'label-front'` and `'label-back'` respectively.
- Extend the `RenderedPage.kind` union: `'form' | 'label-front' | 'label-back' | 'form+label-front' | 'form+label-back' | 'label'`. The legacy `'label'` tag stays for back-compat in tests but the new pipeline prefers the explicit Front/Back tags.

**Patterns to follow:** the existing `FORM_PAGE_MARKERS` + `LABEL_PAGE_MARKERS` constants and `classifyPage()` function show the established pattern — extend with two more marker arrays.

**Test scenarios:**
- **Chacewater fixture (3 pages):** classify; expect Page 1 = `'form'`, Page 2 = `'form'` (marker-bearing chrome, not artwork itself), Page 3 = `'label-back'` if the marker on Page 2 says "Image Type: Back". Assert `pickPagesToRender` excludes Page 2 from the viewer-visible page list.
- **Bouchard fixture (4 pages):** Page 1 = `'form'`, Page 2 = `'form'`, Page 3 = `'label-front'` (the front-marker on Page 2 points to Page 3 artwork), Page 4 = `'label-back'`.
- **Single-page synthetic fixture (form + label on one page):** kind stays `'form+label-front'` so the viewer still has a Front tab.
- **Marker on last page (synthetic):** `'label-back'` tag falls back to the marker page itself (graceful — better to show that page as Back than to show nothing).
- **No markers anywhere (legacy synthetic fixture):** classifier falls back to the existing heuristic — tag any image-bearing low-text page as `'label-back'` by default since that's where the GW lives.

**Verification:**
- `src/lib/pdf/render.test.ts` passes with the new fixtures.
- Re-running `scripts/tesseract-spike.ts` against bouchard shows the Page 4 GW falling under `'label-back'`, not just `'label'`.

---

### U4. OCR-first extractor with per-field VLM fallback

**Goal:** Build the new extractor that orchestrates Tesseract OCR + field-assignment + VLM fallback, replacing the GPT-4o provenance path. Delete the `EXTRACT_PROVENANCE` flag and the provenance prompt variant.

**Requirements:** In-scope items 1, 2, 3; KD1, KD2, KD3, KD4, KD6.

**Dependencies:** U1 (baseline to compare against), U2 (findings inform region rects + threshold), U3 (worker available), **U11 (renderer emits `'label-front'` / `'label-back'` tags this unit consumes)**.

**Files** (expanded after doc review found provenance touches at least 19 files, not the 6 originally listed):
- `src/lib/ocr/config.ts` — new; exports `OCR_CONFIDENCE_THRESHOLD = 60`, region rect tables for TTB form items (per-item `{x, y, width, height}` at 200 DPI against TTB Form 5100.31 06-2016)
- `src/lib/ocr/tesseract.ts` — new; one full-page OCR call per page, returns `{ words: WordRect[] }` (KD1, KD7)
- `src/lib/extraction/tesseract-extractor.ts` — new; orchestrates OCR → field assignment → fallback. Per scope-guardian's review the field-assigners can be inlined here for v1; we won't pre-emptively decompose into a subdirectory with shared types until a second extractor implementation needs them
- `src/lib/extraction/factory.ts` — modify; route to `tesseract-extractor` as the default
- `src/lib/extraction/types.ts` — modify; `ExtractedFields` carries `words: WordRect[] | null` per field (null = VLM-fallback). Drop `ProvenanceMap` from this module
- `src/lib/extraction/prompt.ts` — modify; remove `PROMPT_VERSION_NO_PROVENANCE`, add `PROMPT_VERSION_TESSERACT_FALLBACK_V1` for the single-field re-extraction prompt the fallback uses (preserves audit-trail continuity — see doc review's FYI on prompt version naming)
- `src/lib/env.ts` — modify; remove `EXTRACT_PROVENANCE`
- `src/lib/env.test.ts` — modify; remove EXTRACT_PROVENANCE assertions
- `.env.example` — modify; remove `EXTRACT_PROVENANCE` block
- `src/lib/extraction/openai-extractor.ts` — modify; kept as the VLM fallback caller (one-field-at-a-time path). The provenance-prompt code path goes away
- `src/lib/extraction/openai-extractor.test.ts` — modify; update for the single-field fallback contract
- **`src/lib/validation/types.ts` — modify; `VerificationReport.provenance: ProvenanceMap` removed, bboxes flow through `ExtractedFields.words` instead**
- **`src/lib/validation/engine.ts` — modify; `runVerification` no longer takes/returns `provenance`**
- **`src/lib/results/result-types.ts` — modify; `VerificationReportSchema` Zod validator drops `provenance`. Wire-contract change — every NDJSON line through `/api/verify` validates against this; if it stays stale the client rejects every result**
- **`src/db/schema.ts` — modify; the `validation_report` jsonb column's TS type (`$type<VerificationReport>()`) tracks the new shape**
- **`src/db/persist-verification.ts` — modify; no functional change, but the input type narrows**
- **`src/lib/pdf/form-widgets.ts` — modify or delete; the AcroForm `snapApplicationProvenance` / `synthesizeApplicationProvenance` path operated on the old `ProvenanceLike` shape. KD1 swap means form bboxes come from Tesseract bbox-containment, so AcroForm widget snap is no longer the source-of-truth — delete unless v2 adaptive extraction wants it back**
- **`src/app/(app)/applications/[id]/page.tsx` — modify; the loader detects old-shape rows and surfaces the KD9 graceful-degradation banner**
- **`src/components/queue-page.tsx` — modify; same shape-detection if it consumes `validationReport`**
- `src/lib/extraction/tesseract-extractor.test.ts` — new

**Approach:**

```
extract(pdfBuffer):
  pages = renderApplicationPages(pdfBuffer)
  formPage = pages.find(p => p.kind === 'form' || p.kind === 'form+label')
  labelPages = pages.filter(p => p.kind === 'label' || p.kind === 'form+label')

  formExtraction = runFormAssigner(formPage)
    for each TTB item (1..18):
      crop = cropToRegion(formPage.png, REGION_RECTS[item])
      words = runOcr(crop)  // Tesseract
      assign words.text to canonical field
      attach words[] as bbox source

  labelExtraction = runLabelAssigner(labelPages)
    for each labelPage:
      words = runOcr(labelPage.png)
      match patterns (ABV regex, GW canonical, brand fuzzy, etc.)
      attach matched-word subset[] as bbox source

  combined = merge(formExtraction, labelExtraction)

  for each canonical field f:
    if f.words.length === 0 OR meanConfidence(f.words) < THRESHOLD:
      f.value = await vlmFallback(field=f, image=relevantPage)
      f.words = null  // bbox unavailable
      f.source = 'vlm'

  return combined
```

`vlmFallback(field, image)`: single GPT-4o call asking "Read the {fieldName} from this image. Return only the value, no explanation." No structured-output schema needed (single string).

**Technical design (directional, not implementation specification):**
Form-side region rects live in `config.ts` as `{ itemNumber: { x, y, width, height } }` keyed off the TTB Form 5100.31 layout at 200 DPI. The label-side assigner does full-page OCR then pattern-matches; for the Government Warning it uses fuzzy-token-set against `GOVERNMENT_WARNING_CANONICAL` and collects the matching word rects across however many lines they span.

**Patterns to follow:**
- `src/lib/extraction/openai-extractor.ts` for the extractor contract shape.
- `src/lib/validation/rules/government-warning.ts` for the canonical-text comparison.
- `src/lib/cross-check/normalize.ts` for fuzzy / token-set matching helpers — reuse what's already there.

**Test scenarios:**
- **Happy path — clean cola sample.** Feed a known-good rendered sample through the extractor; assert every required field has `words: WordRect[]` populated and `source === 'tesseract'`.
- **Fallback trigger — empty form field.** Mock Tesseract to return zero words for the brand-name region; assert the extractor calls `vlmFallback` exactly once for `brandName` and the result has `source === 'vlm'` and `words === null`.
- **Fallback trigger — low confidence.** Mock Tesseract to return one word with confidence 40 for the ABV field; assert fallback fires and the field's final `words === null`.
- **No fallback — confidence at threshold.** Mock Tesseract to return three words averaging 65 confidence; assert no fallback fires.
- **Multi-line field bbox collection.** Feed a synthetic page where the Government Warning spans three lines; assert `governmentWarning.words.length` covers all three lines (not just the first).
- **Form-side region cropping.** Feed a synthetic form page where Item 7 (Fanciful Name) contains the literal text "TEST FANCIFUL"; assert the form-side assigner returns `fancifulName: "TEST FANCIFUL"` with bboxes inside the Item 7 region.
- **Label-side pattern match — ABV.** Feed words `[..., "40%", "ALC/VOL", ...]` to the label assigner; assert ABV field gets those two word rects.
- **Label-side pattern match — Government Warning.** Feed the canonical GW text split across words; assert GW field gets the matched word subset, case-insensitive (per existing `government-warning.ts`).
- **Empty PDF — graceful failure.** Feed an empty rendered-pages array; assert extractor throws a clear `OcrExtractionError`, not a TypeError.

**Verification:**
- All unit tests pass.
- Manual run against the U1 baseline sample shows non-zero `words` populated for at least the rule-driving fields.

---

### U5. Baseline parity gate + threshold tuning

**Goal:** Re-run the U1 baseline workflow against the new extractor, diff field-by-field, and gate: refuse to advance until accuracy is within ±5% and latency is no worse than the GPT-4o baseline. Tune the confidence threshold against observed false-positive/negative rates.

**Requirements:** Success criteria — ±5% accuracy parity, latency floor, ≥80% cost reduction.

**Dependencies:** U1, U4.

**Files:**
- `scripts/baseline-compare.ts` — new; runs new extractor on 20 samples, compares to U1 JSON
- `evals/baselines/2026-06-11-tesseract-cola.json` — new, output artifact
- `evals/baselines/comparison-report.md` — new; written by the script with per-sample / per-field diff table
- `src/lib/ocr/config.ts` — modify; finalize threshold based on observed data

**Approach:**
Iterate the 20 cola samples again, this time through `tesseractExtractor.extract()`. Capture: `{ filename, extractedFields, latencyMs, vlmFallbackFields[], words[] }`. Diff against `2026-06-11-gpt4o-cola.json`:
- Per-field exact match → accuracy point.
- Per-field "close enough" via existing `cross-check/normalize.ts` helpers (brand fuzzy, producer token-set) → soft accuracy point.
- Latency delta per sample.
- Cost delta: 1 LLM call per fallback × $0.0005-ish vs 1 LLM call full extraction × $0.03-ish.

The script writes a markdown report (`comparison-report.md`) with the diff table and a verdict header: `PASS` (within ±5%, latency ≤ baseline) or `FAIL` (with the list of regressions).

If FAIL, tune the threshold in `config.ts`, re-run, iterate. If still FAIL after a tuning pass, document the regression and decide (per-field VLM expansion, region-rect adjustment, region-vs-adaptive flip).

**Test scenarios:**
- Test expectation: none on the script itself — it's a comparison runner.
- **Baseline parity test** lives in `src/lib/extraction/tesseract-extractor.parity.test.ts`: a vitest run that reads both baseline JSONs and asserts mean field-extraction accuracy ≥ baseline − 5%. This test runs in CI and gates merge.

**Verification:**
- `evals/baselines/comparison-report.md` exists with a PASS verdict.
- The parity vitest passes.
- Mean latency in the Tesseract baseline ≤ mean latency in the GPT-4o baseline.
- Cost reduction estimated and noted in the report.

---

### U6. New `/applications/[id]` layout — 50/50 split

**Goal:** Restructure the detail-page layout so the left pane is the extraction-inspection panel and the right pane is the source viewer. No viewer content yet — that's U7 — but the container, the page header strip, and the panel split land here.

**Requirements:** Detail page redesign — 50/50 split.

**Dependencies:** None (parallel-safe with U3/U4/U5; UI only).

**Files:**
- `src/app/(app)/applications/[id]/page.tsx` — modify; new layout container
- `src/components/detail-report-view.tsx` — modify; emits left-panel content only
- `src/components/detail-page-shell.tsx` — new; 50/50 grid + header strip + viewer slot
- `src/components/finalize-form.tsx` — modify; refactor into a compact header variant
- `src/components/pdf-modal.tsx` — delete
- `src/components/site-header.tsx` — unchanged
- `src/app/(app)/applications/[id]/page.test.tsx` — new

**Approach:**
`detail-page-shell.tsx` owns the page layout: a header strip at the top with breadcrumbs + condensed Finalize controls + the existing "View full PDF" button is removed, and below it a 50/50 grid with `<DetailReportView />` on the left and a `<SourceViewer />` slot on the right. The shell holds the shared `selectedField` state.

Finalize moves into the header strip as a compact horizontal layout: AI verdict pill → Approve/Reject toggle → reviewer initials → Finalize button → "(flipped from AI)" indicator. The reason textarea pops over on click of a "Reason" link/button, not always-open.

**Patterns to follow:** existing `report-sections.tsx` for the left-panel content shape; `site-header.tsx` for the header-strip aesthetics.

**Test scenarios:**
- **Layout renders both panels.** Page renders with a left panel containing TTB Label Rules + Side-by-side + Form fields, and a right panel containing the viewer slot.
- **Header strip contains Finalize controls.** Approve, Reject, Initials input, Finalize button all present.
- **Reason field is not always visible.** Reason input is collapsed by default; clicking "Reason" toggles it visible.
- **No "View full PDF" button anywhere on the page.**
- **`pdf-modal.tsx` is deleted** — search asserts no imports remain.

**Verification:**
- Existing finalize integration test still passes after the header refactor.
- Visual QA at 1440×900: both panels above the fold, no horizontal scroll.

---

### U7. Source viewer with tabs + zoom/pan

**Goal:** Build the right-pane source viewer: tab strip `[Form][Front][Back]`, always visible, greyed when no content. Zoomable + pannable viewport for both PDF pages and label PNGs.

**Requirements:** Detail page redesign — viewer with tabs, zoom + pan.

**Dependencies:** U6.

**Files:**
- `package.json` — add `react-zoom-pan-pinch`
- `src/components/source-viewer.tsx` — new; tab strip + active tab content
- `src/components/source-viewer-tabs.tsx` — new; the tab strip itself
- `src/components/zoom-pan-canvas.tsx` — new; `react-zoom-pan-pinch` wrapper for PDF page + image
- `src/components/bbox-overlay.tsx` — new; renders the `WordRect[]` highlight overlay
- `src/components/source-viewer.test.tsx` — new

**Approach:**
The viewer takes the `selectedField` state + the application's rendered pages. Tabs map to source kinds: `Form` → the form-page PNG, `Front` → the first label PNG, `Back` → the second label PNG if present. Tabs without backing pages are rendered but disabled (greyed). Viewer tabs are `Form / Front / Back` only — Finalize lives in the page header strip per U6, not inside the viewer. When no field is selected and no tab has been clicked, the viewer shows an empty state with a "Click a field to see its source" prompt.

`zoom-pan-canvas.tsx` wraps `react-zoom-pan-pinch`'s `TransformWrapper` + `TransformComponent` around either a `<canvas>` (for the PDF page, rendered via `react-pdf`) or an `<img>` (for the label PNGs). Wheel-zoom, drag-pan, double-click-to-fit, plus visible `[+] [-] [fit]` controls.

`bbox-overlay.tsx` takes the `WordRect[]` from `selectedField.words` and renders absolutely-positioned divs over the zoomable surface with a colored border. Coordinates are in image-pixel space; the overlay applies the same transform as the underlying content (TransformWrapper provides the matrix).

**Patterns to follow:** existing `pdf-viewer.tsx` for `react-pdf` setup; the deleted `pdf-modal.tsx` for the prior zoom/pan attempt to inform what didn't work.

**Test scenarios:**
- **Tab strip renders three tabs.** `Form`, `Front`, `Back` all present.
- **Disabled tab when no Back page.** A test fixture with no back-label page renders `Back` tab as disabled / aria-disabled.
- **Tab switch swaps content.** Clicking `Front` changes the active content from form PNG to front-label PNG.
- **Zoom-in increases scale.** Wheel-up event increases the transform scale.
- **Drag pans the viewport.** Mousedown + mousemove translates the transform.
- **Fit button resets transform.** Click `[fit]` returns scale to 1 and translation to (0, 0).
- **Bbox overlay renders on a selected field.** Given `selectedField.words = [{x:10, y:20, w:50, h:15}]`, an overlay div appears at those coordinates.
- **Empty state when no selection and no tab clicked.** Viewer shows the "Click a field" prompt.

**Verification:**
- All viewer component tests pass.
- Manual zoom + pan QA on a real cola PDF feels smooth (no jank under 60fps).

---

### U8. Click-to-bbox routing — left-panel clicks drive right-panel state

**Goal:** Wire every extracted-field row in the left panel to the shared `selectedField` state so that clicking a field switches the right pane to the right tab and highlights the bbox. VLM-fallback fields surface a "source not available" overlay.

**Requirements:** Detail page redesign — click extracted field → switch tab + highlight; VLM-fallback "source not available".

**Dependencies:** U6, U7.

**Files:**
- `src/components/report-sections.tsx` — modify; every rule + side-by-side + form-field row becomes a button with `onClick={onSelect(fieldId)}`
- `src/components/detail-report-view.tsx` — modify; threads `onSelect` prop from the page shell
- `src/components/source-viewer.tsx` — modify; reads `selectedField`, switches tab + scrolls into view + highlights
- `src/app/(app)/applications/[id]/page.tsx` — modify; owns `selectedField` state, threads it both directions
- `src/lib/detail-view/select-field.ts` — new; pure mapping `fieldId → { source: 'form' | 'front' | 'back', words: WordRect[] | null }`
- `src/components/no-source-overlay.tsx` — new; "this field came from the AI — exact source on the page isn't available" message
- `src/lib/detail-view/select-field.test.ts` — new
- `src/components/no-source-overlay.test.tsx` — new

**Approach:**
`select-field.ts` is the brain: given a `fieldId` (e.g., `'brandName'`, `'governmentWarning'`, `'item7-fancifulName'`) and the loaded `ExtractedFields` payload, return which tab the field came from and which word rects to highlight. For VLM-fallback fields, return the tab the field *would* come from + `words: null` so the viewer can switch tabs and render the no-source overlay.

The selection flow:
1. User clicks a row in the left panel.
2. `onSelect(fieldId)` updates page-level `selectedField`.
3. Viewer subscribes; switches active tab; if `words !== null`, scrolls/zooms to fit the bboxes and renders the overlay; if `words === null`, switches tab + renders `<NoSourceOverlay />` instead.

**Patterns to follow:** `report-sections.tsx` already has clickable rows for `pdf-modal` — adapt the same handler shape.

**Test scenarios:**
- **Click form-side field → Form tab + bbox.** Click brandName row; assert active tab is `Form` and overlay shows the brandName word rects.
- **Click label-side field → Front tab + bbox.** Click ABV row (label-side); assert active tab is `Front` and overlay shows the ABV word rects.
- **Click back-label field → Back tab.** A field whose words originate on the back-label page switches to `Back`.
- **Click VLM-fallback field → tab switches + no-source overlay.** A field with `source === 'vlm'` and `words === null` switches to the appropriate tab and renders `<NoSourceOverlay />`.
- **Click same field twice → toggle off.** Clicking the currently-selected field deselects it (viewer returns to empty state).
- **Field-to-source mapping is pure.** `selectField('brandName', mockExtraction)` returns the same `{ source, words }` shape deterministically.
- **Cross-check row clicks resolve to label side.** Clicking a row in the Side-by-side panel selects the label-side word rects, not the application-side AcroForm rect (which we don't compute in v1).

**Verification:**
- All routing tests pass.
- Manual QA: click each row in the left panel against a real cola sample, confirm visual highlights look right.

---

### U9. Header-bar Finalize — compact layout

**Goal:** Polish the Finalize controls that landed in the header strip during U6: aesthetic alignment, popover behavior on the Reason field, keyboard navigation, "(flipped from AI)" indicator.

**Requirements:** Detail page redesign — Finalize in header, reason expands on demand.

**Dependencies:** U6 (the structural move), U8 (final layout pass after click routing lands and we know how much horizontal space the header has).

**Files:**
- `src/components/finalize-form.tsx` — modify; finalize the compact variant
- `src/components/finalize-reason-popover.tsx` — new; popover/inline-expand for the reason text
- `src/components/finalize-form.test.tsx` — modify; add tests for the compact variant

**Approach:**
Compact horizontal layout that fits in a ~600px header right-side region:
```
[AI: Needs review · Approve]  [Approve][Reject]  [JP]  [Reason ▾]  [Finalize]
```
The Reason button toggles a popover (or expands a row below the strip; pick whichever testing shows works better at narrow widths). Reviewer initials stay as an inline `<input>` (autocomplete from prior session via localStorage — deferred, noted only).

Existing form submission via Server Action stays untouched.

**Patterns to follow:** existing `finalize-form.tsx` (the structural pieces — verdict pill, decision buttons, finalize submit handler) are unchanged.

**Test scenarios:**
- **Compact header renders all controls.** Verdict pill, Approve, Reject, Initials input, Reason button, Finalize button all visible.
- **Reason popover toggles on click.** Click "Reason" → popover open with textarea; click outside or "Reason" again → closed.
- **Submitting with empty reason still works.** Reason is optional; form submits without it.
- **"Flipped from AI" indicator appears when reviewer overrides.** AI suggests Approve → reviewer clicks Reject → "(flipped from AI)" amber indicator visible.
- **Finalize submit still routes to `/api/finalize`.** Server-action POST fires with correct payload.
- **Approved state styles correctly.** When already approved/rejected, the finalize controls render in their post-decision state (existing behavior preserved).

**Verification:**
- All finalize-form tests pass (modified + new).
- Visual QA on 1440×900: header strip not visually cramped; popover doesn't overlap viewer awkwardly.

---

### U10. Vercel deploy validation

**Goal:** Confirm the new bundle deploys cleanly to Vercel and a real verify request succeeds end-to-end against a preview deployment. Surface any nft / lambda-size / cold-start issues before merge.

**Requirements:** Dependencies — Vercel lambda includes Tesseract assets.

**Dependencies:** U3, U4, U5.

**Files:**
- `docs/plans/2026-06-11-001-feat-tesseract-bbox-detail-view-plan.md` — this plan; appended deploy report
- `next.config.mjs` — modify if validation surfaces missing file traces

**Approach:**
1. `npm run build` locally; inspect `.next/server/app/api/verify/route.js.nft.json` for `tesseract-core.wasm` and `eng.traineddata`.
2. Push branch to GitHub; Vercel creates a preview deployment.
3. Upload one of the 20 cola PDFs through the preview's `/` page.
4. Verify: no `Cannot find module` errors, no lambda-size errors, verdict + bboxes returned.
5. If errors: add missing paths to `outputFileTracingIncludes`, push, re-test.
6. Record final lambda size, cold-start time, warm latency in the plan's appendix or a separate `docs/deploys/` note.

**Patterns to follow:** today's `fix(vercel): force-include pdfjs worker + fonts in /api/verify bundle` commit and `feedback-nft-runtime-paths.md` memory.

**Test scenarios:**
- Test expectation: none — this is a deploy gate, not a unit.

**Verification:**
- Vercel preview build succeeds.
- `/api/verify` returns a 200 with the new bbox-bearing payload on at least one real cola PDF.
- Lambda cold-start latency documented; warm latency documented.

---

## Test Strategy

- **Unit tests** on `tesseract.ts`, `tesseract-extractor.ts`, `field-assigners/form.ts`, `field-assigners/label.ts`, `select-field.ts` — pure logic and deterministic mocks for Tesseract output.
- **Component tests** on `source-viewer.tsx`, `source-viewer-tabs.tsx`, `bbox-overlay.tsx`, `no-source-overlay.tsx`, `report-sections.tsx` (clickable rows), `finalize-form.tsx` (compact variant).
- **Integration test** on `/api/verify/route.ts` with a mocked Tesseract worker that returns deterministic words for one of the existing scenario fixtures, asserting the new payload shape.
- **Parity test** in `tesseract-extractor.parity.test.ts` — reads both baseline JSONs, asserts mean accuracy within ±5%. This is the merge gate.
- **No live LLM in CI** — fallback paths use mocked `vlmFallback`.
- **Manual smoke** via Vercel preview deploy on a real cola PDF (U10).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OCR quality on decorative label text (brand wordmarks, fanciful names) is poor enough that fallback fires on most labels | Medium | High — defeats the cost + speed wins | U2 spike measures this; if fallback density > 50% we re-evaluate; U5 parity gate enforces accuracy floor |
| Tesseract WASM + `eng.traineddata` push lambda past Vercel's size limit | Low | Medium — would force a different bundling strategy | U10 measures actual bundle size; mitigation is offloading `eng.traineddata` to a CDN and `fetch()`ing it lazily (deferred only if needed) |
| Region-based form extraction is fragile across non-standard COLA exports | Medium | Medium — fallback covers it but at LLM cost | KD1 + U5 metrics surface fragility; adaptive landmark strategy is the v2 fallback |
| `react-zoom-pan-pinch` × `react-pdf` integration is finicky around page-change scale recalculation | Medium | Low — UI polish, not correctness | Half-day budget in U7 to validate the combo; if it fights us, fall back to `react-pdf`'s native scale prop + a simple `transform: scale(...)` div for pan |
| Cold-start latency rises noticeably from Tesseract worker init | High | Low — first request only | KD7 caches the worker; warm requests pay nothing; documented in U10 |
| Bbox highlight coordinates drift between Tesseract pixel-space and the rendered viewport (DPR, CSS scale) | Medium | Medium — visible misalignment | Lock a single coordinate space: Tesseract returns image-pixel coords; viewer renders at native scale + `react-zoom-pan-pinch` applies the matrix uniformly |

---

## Deferred Implementation Notes

Things we will not pretend to know now:
- Exact region rect coordinates for each of the 18 TTB form items (U4 will hand-tune against the 20 samples).
- Final confidence threshold (U5 will tune from 60 against observed data).
- Whether the parity gate passes on the first run or requires field-assigner iteration (U5 may loop).
- The exact final shape of the compact header strip (U9 will iterate at the visual layer after U6 lands).

---

## Open Questions Resolved in This Plan

| Origin question | Resolution |
|---|---|
| Confidence threshold for fallback | KD4 — start at 60, tune in U5 |
| Form-half strategy on flattened PDFs | KD1 — **full-page OCR + bbox-containment** (revised after U2 spike) |
| Bbox shape per field | KD2 — word-rect list |
| VLM fallback wire shape | KD3 — per-field, single-call |
| All sections clickable or only some? | U8 — all sections (rules, side-by-side, form fields) are clickable rows |
| `EXTRACT_PROVENANCE` flag fate | KD6 — deleted in U4 |
| **D1 — Renderer Front/Back distinction** | **KD8 + U11 — `Image Type:` marker detection, tag next page** |
| **D2 — DB migration for archived rows** | **KD9 — graceful degradation, no destructive migration** |
| **D3 — U4 file list completeness** | **U4 Files: section expanded to cover all 19+ provenance call sites** |
| **Selection key type (FieldPath vs new fieldId)** | **KD5 — FieldPath stays canonical, no parallel namespace** |

---

## Phased Delivery

**Phase A — De-risk (U1, U2):** parallel-runnable; produces baseline JSON + Tesseract spike findings. ✅ Complete as of 2026-06-11 (commits `d4e9f68`, `76831e1`).

**Phase B — Extraction swap (U3, U11, U4, U5):** mostly sequential. **U11 (renderer Front/Back tagging) runs in parallel with U3 (WASM bundling) and blocks U4.** U5's parity gate is the merge blocker.

**Phase C — UI redesign (U6, U7, U8, U9):** mostly sequential within the phase but parallel to Phase B. U6 can land before U4 if helpful; U7/U8/U9 layer on top.

**Phase D — Deploy gate (U10):** runs after Phase B + C land on the branch; final pre-merge check.

---

## Documentation Plan

- `README.md` — update the "Architecture" + "Cost" + "Stack" sections to reflect Tesseract-first extraction.
- `evals/baselines/README.md` — new; explains baseline format.
- `evals/README.md` — note the new parity gate.
- `.env.example` — remove the `EXTRACT_PROVENANCE` block.
- `.claude/HANDOFF.md` — replaced by the next session's HANDOFF, no special update needed.

---

## Next Step

Execute via `/ce-work` against this plan, or break into discrete tasks for parallel execution.

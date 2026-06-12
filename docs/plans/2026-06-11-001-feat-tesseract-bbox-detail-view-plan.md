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

### KD1. Form-side OCR strategy: region-based for v1
TTB Form 5100.31 has stable item locations across COLA Online exports. Crop the rendered form page into per-item rects (Item 1: serial number, Item 2: plant registry, Item 3: source, …), run Tesseract on each crop, assign the recognized text to the corresponding form field. Simple, deterministic, and easy to reason about.

Trade-off: fragile to non-standard exports (different form versions, scanned vs digital). Mitigation: the VLM fallback catches anything the region-based path misses. Adaptive (landmark-relative) extraction is deferred to v2.

### KD2. Per-field bbox shape: list of word rects
Each extracted field stores a list of `{x, y, w, h, confidence, text}` per matched word, not a single union rect. The Government Warning spans multiple lines on real labels and would render as one huge box covering decorative artwork between its tokens if we used union rects. List-of-word-rects lets the overlay component render N tight highlights that hug the actual glyphs.

Trade-off: slightly more data per field, slightly more render work. Acceptable.

### KD3. VLM fallback: per-field, single-call
For each field where Tesseract returned no match or confidence below threshold, make one VLM call asking for *just that field's value*. No bbox in the response. Simpler to reason about + easier to debug than batched per-page calls. Fallbacks should be rare on consistent exports.

Trade-off: more API calls if many fields fall back. If profiling shows fallback density is high, batched-per-page is a v2 optimization.

### KD4. Tesseract confidence threshold for fallback: 60 (v1 default, tuned in U5)
Tesseract returns 0–100 confidence per word. Initial threshold for "trigger fallback" is **<60 mean confidence across the words assigned to a field**, OR **zero words assigned**. The threshold is recorded in `src/lib/ocr/config.ts` so it can be tuned against the 20 cola samples during U5 baseline parity validation without code-touching downstream paths.

### KD5. Single shared selection state at the page level
The click-to-bbox routing uses one `selectedField: { fieldId, source: 'form' | 'front' | 'back', words: WordRect[] } | null` state owned by the `/applications/[id]` page. Left panel rows are clickable and dispatch `onSelect(fieldId)`; right panel viewer subscribes to `selectedField`. No global store needed; React `useState` + props.

### KD6. Replace, don't dual-run
The new Tesseract extractor *replaces* the GPT-4o provenance code path entirely. No feature flag for parallel pipelines, no `EXTRACT_PROVENANCE`. One source of truth for bboxes. The risk this incurs (regression on label quality if Tesseract underperforms) is gated by U5 (baseline parity) before any merge.

### KD7. Tesseract.js worker init: lazy + cached
Tesseract.js's `createWorker()` loads `eng.traineddata` (~10 MB) on first call. Cache the worker instance at module scope so each `/api/verify` request after the first reuses it; Vercel lambdas reuse warm instances across requests. Cold start adds ~1–2s; warm requests pay no init cost.

---

## System-Wide Impact

- **`/api/verify` route handler:** payload shape changes — `provenance` field on the result line is replaced by per-field `words: WordRect[]`. NDJSON stream contract bumps version.
- **DB persistence:** `applications.report_json` schema changes (one new column or schema-bump). Existing applications stay readable via a one-time migration that drops the legacy `provenance` field.
- **Detail-view consumers:** `report-sections.tsx`, `detail-report-view.tsx`, `finalize-form.tsx`, `pdf-viewer.tsx`, `pdf-modal.tsx` all touched. `pdf-modal.tsx` is deleted.
- **Vercel lambda bundle:** Tesseract WASM (~3 MB) + `eng.traineddata` (~10 MB) added to `/api/verify` via `outputFileTracingIncludes` — same pattern as the pdfjs worker fix today.
- **Cost surface:** extraction cost drops from ~$0.02–0.05 per verify to near-zero for Tesseract-handled fields; only fallback fields pay LLM cost. Vercel function CPU-seconds rise modestly (Tesseract is CPU-bound).
- **Latency surface:** form half + label half OCR can run in parallel. Expected: ~3–6s on a typical 3-page export, faster than current.
- **Tests:** ~5 new test files; existing extraction tests retarget the new module.

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

### U4. OCR-first extractor with per-field VLM fallback

**Goal:** Build the new extractor that orchestrates Tesseract OCR + field-assignment + VLM fallback, replacing the GPT-4o provenance path. Delete the `EXTRACT_PROVENANCE` flag and the provenance prompt variant.

**Requirements:** In-scope items 1, 2, 3; KD1, KD2, KD3, KD4, KD6.

**Dependencies:** U1 (baseline to compare against), U2 (findings inform region rects + threshold), U3 (worker available).

**Files:**
- `src/lib/ocr/config.ts` — new; exports `OCR_CONFIDENCE_THRESHOLD = 60`, region rect tables for TTB form items
- `src/lib/ocr/tesseract.ts` — new; runs Tesseract on a page, returns words with bboxes
- `src/lib/extraction/tesseract-extractor.ts` — new; orchestrates OCR → field assignment → fallback
- `src/lib/extraction/field-assigners/form.ts` — new; region-based assigner for TTB Form 5100.31 items
- `src/lib/extraction/field-assigners/label.ts` — new; pattern-based assigner (regex for ABV, canonical-text for GW, fuzzy for brand)
- `src/lib/extraction/field-assigners/types.ts` — new; `WordRect`, `FieldExtraction`, `AssignerResult`
- `src/lib/extraction/factory.ts` — modify; route to `tesseract-extractor` as the default
- `src/lib/extraction/types.ts` — modify; `ExtractedFields` carries `WordRect[]` per field instead of `ProvenanceMap`
- `src/lib/extraction/prompt.ts` — modify; remove `PROMPT_VERSION_NO_PROVENANCE`, keep one fallback prompt for single-field re-extraction
- `src/lib/env.ts` — modify; remove `EXTRACT_PROVENANCE`
- `src/lib/env.test.ts` — modify; remove EXTRACT_PROVENANCE assertions
- `.env.example` — modify; remove `EXTRACT_PROVENANCE` block
- `src/lib/extraction/openai-extractor.ts` — modify or delete (kept only if used by the fallback; otherwise delete)
- `src/lib/extraction/tesseract-extractor.test.ts` — new
- `src/lib/extraction/field-assigners/form.test.ts` — new
- `src/lib/extraction/field-assigners/label.test.ts` — new

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
| Form-half strategy on flattened PDFs | KD1 — region-based v1, adaptive deferred |
| Bbox shape per field | KD2 — word-rect list |
| VLM fallback wire shape | KD3 — per-field, single-call |
| All sections clickable or only some? | U8 — all sections (rules, side-by-side, form fields) are clickable rows |
| `EXTRACT_PROVENANCE` flag fate | KD6 — deleted in U4 |

---

## Phased Delivery

**Phase A — De-risk (U1, U2):** parallel-runnable; produces baseline JSON + Tesseract spike findings.

**Phase B — Extraction swap (U3, U4, U5):** sequential; U5's parity gate is the merge blocker.

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

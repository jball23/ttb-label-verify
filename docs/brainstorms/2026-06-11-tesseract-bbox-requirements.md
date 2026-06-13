# Tesseract.js OCR + bounding-box-driven detail view

**Branch:** `feat/tesseract-bbox`
**Date:** 2026-06-11
**Status:** Requirements — ready for planning

---

> Historical note: this captured the OCR/bbox pivot before the current PDF
> prepass and consolidated review UI landed. Use `README.md` as the current
> source of truth for deployment.

## Problem

Two real complaints with the current extraction + detail-view experience:

1. **End-to-end extraction is slow.** GPT-4o vision dominates the ~10–15s budget per PDF, and the cost-per-verify is meaningful even at demo scale. Worse, when `EXTRACT_PROVENANCE=true` is enabled to get bboxes, latency grows another 3–4s and the model's bbox quality is poor enough that the prior session disabled the flag by default.
2. **The reviewer can't see where extracted values came from.** At the time this was written, the detail page listed rule outcomes and side-by-side comparisons in the left pane and showed the PDF only behind a "View full PDF" modal. A reviewer could read "Read: 5.17 gal" on the Net Contents row but had no way to point at the spot on the label that said it. This is the core compliance question — *where did the AI get this?* — and the then-current UI didn't answer it.

Colleagues working the same TTB-label problem have shown that **OCR with native word-level bboxes** ships a much better reviewer experience than vision-LLM-only extraction.

## Goals

- Every extracted field on the detail page is clickable and resolves to a bbox on the source PDF or label image.
- Extraction quality is on par with the current GPT-4o-only baseline on the 20 real cola samples in `public/samples/cola/`.
- End-to-end verify latency is no worse than today's `EXTRACT_PROVENANCE=false` path; ideally faster and dramatically cheaper.
- Detail page layout splits the screen 50/50: extraction info on the left, a real zoomable PDF/image viewer on the right.

## Non-goals

- Not training or fine-tuning any detection model. No Roboflow / supervision / custom YOLO.
- Not adding a Python sidecar service. Everything stays in the Next.js / Node runtime.
- Not changing the rule engine, cross-check engine, verdict tiering, queue lifecycle, or finalize/archive flow. Those consume `ExtractedFields` the same way regardless of how the fields were read.
- Not implementing OCR preprocessing beyond what Tesseract.js needs out-of-the-box (deskew, threshold). If accuracy ceilings force us there, that's a separate pass.

## Approach (mechanism-level)

**Tesseract.js as the primary extractor, VLM as targeted fallback.**

1. PDF → 200 DPI PNG per page (unchanged from current `renderApplicationPages`).
2. Tesseract.js runs over each rendered page → words + per-word bbox + per-word confidence.
3. Field assignment:
   - **Form half:** TTB Form 5100.31 has fixed item locations on the page. Crop by region or use AcroForm widget rects if the PDF preserves them, then OCR-within-region → assign to canonical form fields.
   - **Label half:** full-page OCR + pattern matching. Regex for ABV format, exact-canonical-text comparison for the Government Warning, fuzzy for brand, etc. Each field stores the union of word-bboxes its tokens came from.
4. **Fallback:** for any field that is missing, empty, or whose union confidence is below a threshold (TBD, planning will tune against the cola samples), the system makes a single VLM call asking for *just that field*. The fallback path returns text only; **no bbox is available**, and the UI signals this clearly ("source not available").

This deletes the `EXTRACT_PROVENANCE` flag and the GPT-4o provenance / bbox code path — the new pipeline is the only source of bboxes.

## Detail page redesign

The `/applications/[id]` route changes layout. The left half stays the extraction-inspection panel (TTB Label Rules, Side-by-side, Application form fields — same content, same section order). The right half becomes the source viewer.

**Right pane — viewer with tab strip:**

- Tab strip at the top: `[Form] [Front] [Back]`. All tabs always visible. Tabs that have no content (e.g., `Back` when the PDF has no separate back-label page) render greyed and disabled.
- Below the tab strip: a zoomable, pannable viewer (`react-zoom-pan-pinch` over the PDF page or label PNG). Wheel-to-zoom, drag-to-pan, double-click to fit, controls for `[+] [-] [fit]`.
- Each tab renders the corresponding source: `Form` shows the page our page-classifier picked as the form; `Front` and `Back` show the respective rendered label PNGs.

**Click-to-bbox routing:**

- Every extracted-field row in the left panel is clickable.
- Clicking a field switches the right pane to whichever tab contains that field's source (Form fields → Form tab; label-side fields → Front or Back, whichever bbox lives on).
- The viewer scrolls/zooms to the bbox and renders a highlight overlay.
- Fields that came from the VLM fallback are still clickable; they switch to the tab that *would* hold the source and surface an inline "this field was filled in by AI — exact source on the page isn't available" message.

**Header — Finalize:**

The Finalize card on the right side disappears. The "View full PDF" button disappears (the viewer is always visible now, no modal needed). The freed header space on the top right of the page carries the Finalize controls:

- AI verdict pill
- `Approve` / `Reject` decision toggle
- Reviewer initials field
- `Finalize` button
- The reason textarea expands on demand (popover or inline-below-row when the reviewer wants to add notes) — it doesn't sit open by default.

The existing review-history (post-finalize "Approved by JB on …" history) keeps its current position.

## Success criteria

- 100% of fields extracted via Tesseract have a clickable bbox visible in the right pane.
- Field-extraction accuracy on the 20 cola samples is within **±5%** of the current GPT-4o-only baseline measured against the same set. Baseline is captured *before* the swap so we can compare apples to apples.
- End-to-end `/api/verify` latency on a typical 3-page export is **≤ current `EXTRACT_PROVENANCE=false` path**.
- Per-verify cost drops by **≥80%** (Tesseract is free; VLM fallback only fires on hard fields).
- The detail page renders both panels above the fold at a standard laptop viewport (1440 × 900) without horizontal scrolling, and the viewer supports zoom + pan smoothly with no perceptible lag.

## Scope boundaries

**In scope**
- New Tesseract.js extraction module + per-field assignment for both form and label halves.
- VLM fallback path: single-field re-extraction with no bbox, with a clear UI indicator.
- Replacement of `EXTRACT_PROVENANCE` flag + GPT-4o provenance code with the new bbox source.
- New `/applications/[id]` layout: 50/50 split, tabbed right-pane viewer, header-bar Finalize.
- A baseline capture of current GPT-4o-only accuracy on the 20 cola samples so we can verify parity.

**Deferred (next pass)**
- Image preprocessing pipeline (binarization, deskew, denoise) beyond Tesseract defaults.
- Tesseract language packs beyond English.
- "Re-OCR this field" reviewer action when a bbox is visibly wrong.
- Visual confidence indicator on the bbox itself (color border by confidence band).
- Persisting the rendered page PNGs in DB so the detail view doesn't re-render on every load.

**Outside the product's identity**
- COLAs system integration.
- Roboflow / supervision / custom detection model training.
- Python sidecar services.

## Dependencies & assumptions

- **Tesseract.js + WASM** fits in the Vercel function size budget. The English `eng.traineddata` is ~10MB; Tesseract WASM ~3MB. The current `/api/verify` lambda already ships `pdfjs-dist` worker + standard fonts via `outputFileTracingIncludes`; we'll add the Tesseract artifacts the same way.
- Real COLA Online exports render the form text as raster pixels (the export is flattened). Planning verifies on the 20 samples whether any preserve AcroForm widget data — if some do, that side gets a faster deterministic path that skips OCR.
- TTB form items have stable enough on-page locations that crop-by-region works for the form half. The 18 items live in known boxes per the published form layout.
- `react-zoom-pan-pinch` (or equivalent) integrates cleanly with `react-pdf`'s `Page` component and with plain `<img>` for the label PNGs.
- Tesseract on 200 DPI PNGs runs ~2–5s per page on a Vercel Node lambda. A 3-page export budget is ~6–15s, which is comparable to current GPT-4o latency.

## Open questions for planning

- **Confidence threshold for fallback** — what Tesseract per-word or per-field confidence triggers the VLM re-extraction? Needs tuning against the cola samples after baseline capture.
- **Form-half strategy on flattened PDFs** — region-based crop with hand-tuned coordinates, or a more flexible "find the label, then OCR to the right of it" approach? Region-based is simpler; flexible is more robust to non-standard exports.
- **Bbox shape per field** — a single union rect, or a list of word rects per field (so the highlight overlay can wrap text that spans lines, e.g., the Government Warning)?
- **VLM fallback wire shape** — single batched call for all low-confidence fields per page, or one-call-per-missing-field? Latency vs token cost tradeoff.
- **Existing detail-page sections** (TTB Label Rules, Side-by-side, Application form fields) — all three become clickable, or only certain rows? Side-by-side compares two values; clicking one vs the other should highlight different bboxes.
- **What happens to `EXTRACT_PROVENANCE` flag and the GPT-4o provenance code?** Assumed deleted (one source of truth for bboxes) — confirm.

## Non-trivial risks

- **OCR quality on decorative label text.** Brand wordmarks, ornate fanciful names, and stylized warning placements may simply not OCR. Fallback handles this for the value but bbox is lost. If too many fields fall back, we lose the "show me where" promise. Mitigation: measure on the 20 cola samples before broad rollout.
- **Tesseract.js cold-start in Vercel serverless.** Loading `eng.traineddata` from disk on a cold lambda adds latency to the first request. Mitigation: pre-warm via a `runtime` hook or accept the cold-start cost.
- **Region-based form extraction is fragile** to non-standard COLA exports (older form versions, scanned vs digital exports). Mitigation: VLM fallback catches anything region-based misses.
- **react-zoom-pan-pinch + react-pdf interaction** can be finicky around page-change and scale recalculation. Mitigation: budget a half-day to validate the combo before locking the viewer choice.

## Next step

Hand to `/ce-plan` for the implementation breakdown.

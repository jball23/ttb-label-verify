---
title: "feat: PDF-only verifier with bounding-box provenance"
status: superseded
created: 2026-06-10
plan_type: feat
origin: .claude/HANDOFF.md (2026-06-10 evening — work order section)
deadline: 2026-06-10
---

> Historical plan: kept for design history. `README.md` documents the current
> deployable architecture.

# feat: PDF-only verifier with bounding-box provenance

## Summary

Pivot the verifier's input contract from `application.json + label.jpg` (two-file multipart) to a single `application.pdf` upload that contains BOTH the filled COLA form AND the affixed label artwork on page 1. A single GPT-4o vision call against a 200 DPI rendering of page 1 returns three structures in one shot: an `Application` (mirroring the JSON shape we previously took as input), an `ExtractedFields` (the label half), and a `provenance` map that gives every extracted field a normalized bounding box on the source PDF plus a `confidence` tier. The UI replaces the single-pane result card with a two-pane verifier — PDF viewer (`react-pdf`) on the left, cross-check + rule results on the right — where every extracted value is clickable: clicking a row scrolls the PDF to that page and fades in a highlight over the source region; hovering a bbox highlights the corresponding row. Low-confidence bboxes render with a dashed border.

The cross-check and rule engines from `feat/cross-check` are unchanged — they sit downstream of the new extractor and consume the same `Application` + `ExtractedFields` shapes they already did. The `application.crossCheckExpectations` block is synthesized server-side from the extracted form fields using the same logic that `parseApplication` already encodes.

This plan executes the locked work order in `.claude/HANDOFF.md` (2026-06-10 evening). All scoping, comparator strategy, and bbox approach are user-confirmed and not up for renegotiation here.

---

## Problem Frame

The cross-check pivot established the right verification narrative (application vs label, per-field strict). What it left unresolved is how a TTB reviewer would actually use the tool: in production they receive ONE PDF artifact — the filled Form 5100.31 with the affixed label artwork printed on it — not a tidy structured JSON alongside a clean label image. Asking the user to upload two files (one of them a JSON file they'd never naturally have) breaks the demo's credibility.

The PDF-verifier pivot fixes that AND adds explainability:

1. **One artifact in, one verdict out.** The reviewer uploads the artifact they actually have; the system does the parsing.
2. **Provenance is first-class.** Every extracted value points back to its location on the source document. The reviewer can click any field and see exactly where the system read it from. This is the demo moment.
3. **Confidence is honest.** Vision-LLM bbox accuracy is not perfect; the schema requires the model to self-report `'high' | 'medium' | 'low'` and the UI renders low-confidence bboxes visually distinct (dashed border) so the reviewer knows to eyeball.

Locked decisions from the conversation that produced this plan (see `.claude/HANDOFF.md` § Locked decisions):

- PDF-only input is the new contract. No fallback to the JSON+image path.
- Vision-LLM-only bboxes. No OCR, no Document AI, no Textract. AcroForm-widget-snap is the escape hatch for form fields ONLY, applied only if first-pass quality demands it.
- Single vision call returns Application + ExtractedFields + provenance.
- Two-pane verifier layout (PDF left, results right). Not a modal, not a separate route — replaces the current single-pane card.
- `react-pdf` for the viewer; no rolling our own PDF.js wrapper.
- Cross-check granularity stays per-field strict.
- Scenario picker stays — just loads `.pdf` instead of `.json + .jpg`.
- `feat/cross-check` stays intact as the fallback branch; this work happens on `feat/pdf-verifier` branched off it.

---

## Scope Boundaries

### In scope (this plan)

- Server-side PDF→PNG rendering at 200 DPI (page 1 only) using `pdfjs-dist` + `canvas`.
- Extended `ExtractedFields` is replaced/supplemented by a new `ExtractedDocument` shape: `{ application, label, provenance }`. The existing `Application` and `ExtractedFields` Zod schemas are reused as the inner pieces; only `application.crossCheckExpectations` + `labelOnlyExpectations` are derived server-side from the extracted form.
- New `FieldProvenance` shape: normalized `{x,y,w,h}` (0..1 per page) + `page` (0-indexed) + `confidence` tier.
- Rewritten extractor prompt for dual extraction + bboxes, with `PROMPT_VERSION` bumped to `'2026-06-10.v4'`.
- OpenAI extractor module updated to return `ExtractedDocument` from a single vision call against the rendered PNG.
- Verify route rewritten to accept a single `application.pdf` multipart upload, render page 1, run the extractor, synthesize the cross-check expectations, run `runVerification`, emit NDJSON with `provenance` on every OK line.
- `ResultLine` (and the underlying `VerificationReport`) schema gains a `provenance` field on the result.
- New `PdfViewer` component (`react-pdf` + bbox overlay layer).
- New `VerifierPane` component implementing the two-pane layout with click-to-highlight + hover-to-highlight + selection state.
- Scenario picker repointed to `.pdf` — single fetch, no separate label image. The 5 scenario PDFs already exist under `public/samples/applications/0N-*/application.pdf`.
- Phase reducer state model swapped from `application/files` to `pdfFile / extractedDocument / selectedFieldId`.
- Integration test rewritten to run all 5 scenarios through the new route with a mocked extractor returning deterministic `ExtractedDocument`s.
- README rewritten to cover Tailwind + shadcn (prior pivot) + cross-check + PDF verifier + bboxes.

### Deferred for later

- Multi-page extraction. Pages 2–5 of the COLA PDFs are TTB instructions and are ignored. If a future plan needs to cite from those pages, the FieldPath schema already carries `page` so the data model is forward-compatible.
- Multi-label cross-check (front + back + neck labels). Demo dataset is 1:1.
- Persisting verify results.
- A reviewer-override UI ("mark this mismatch acceptable").
- Pre-existing ABV-rule edge case (rejects combined `% ALC/VOL (PROOF)` format) — explicit follow-up if time allows.
- Re-introducing the JSON+image path as an alternate input. Adding optionality back now would blur the pivot.

### Outside this product's identity

- COLA system integration; still a standalone prototype.
- User accounts / per-reviewer audit trail.
- OCR / non-vision-LLM bbox sources.

---

## Key Technical Decisions

**One vision call, three structures.** A single GPT-4o call against the page 1 PNG returns `{ application, label, provenance }` in one structured-output response. Splitting this into two calls (one for the form, one for the label) doubles cost and latency for no real accuracy gain — the model sees the whole page either way. The dual-extraction prompt is the central design artifact and gets disproportionate attention.

**Bboxes are vision-LLM only.** GPT-4o emits normalized `{x,y,w,h}` directly in the structured response. Tradeoff: ±5–10% drift on dense text. We accept this and surface it honestly:
- The schema REQUIRES `confidence: 'high' | 'medium' | 'low'` on every provenance entry.
- The UI renders `'low'` bboxes with a dashed border + muted color so reviewers know to eyeball.
- Escape hatch: if first-pass quality is unacceptable on a clean field (e.g., brand bbox lands on producer), snap **form-field** bboxes to the AcroForm widget rectangles we already enumerated in `scripts/inspect-form.mjs` + `scripts/calibrate.mjs`. Label-side bboxes stay vision-LLM regardless. Only activate this fallback if quality demands it; otherwise leave the simpler implementation.

**Server-side render at 200 DPI.** GPT-4o's vision model performs measurably worse on heavily-scaled images and on multi-page PDFs (vision input is single-frame). Rendering page 1 to a PNG server-side gives us:
- Deterministic input size for the model (consistent token budget).
- Single-frame focus so the model isn't distracted by the 4 pages of TTB instructions.
- Coordinates the model returns are page-normalized (0..1), so PDF-side bbox overlay math is trivial — we don't need to track the render dimensions in the wire format.

`pdfjs-dist` in Node uses the `legacy/build/pdf.mjs` entry; pair with the `canvas` npm package for the rendering target.

**Cross-check expectations are synthesized server-side.** The extractor returns the literal form contents only (`form.brandName`, `form.producer.name`, etc.). The `crossCheckExpectations` and `labelOnlyExpectations` blocks that downstream code (cross-check engine, validation engine) consume are derived from those form fields using the same mapping `parseApplication` already does. This keeps the prompt schema small and the extractor's job clearly bounded ("read what's printed; don't infer compliance intent").

**Phase reducer model:** the upload state model collapses from `application + files[]` to `pdfFile + extractedDocument + selectedFieldId`. There is no batch concept anymore (one PDF per verify), so the staged-files list goes away. `selectedFieldId` is the single source of truth for "currently selected field" — driven both by clicks in the right pane and (future) by hovers on bboxes.

**React-pdf integration:** `react-pdf` requires `'use client'`, ships its own worker file (must be copied to `public/`), and is large (~250 kB). The viewer component is dynamically imported so `/login` and the initial pre-upload paint don't pay the cost.

**PROMPT_VERSION bumps to `'2026-06-10.v4'`.** Any change to the prompt that changes the response shape must bump the version so Langfuse traces don't conflate the runs.

---

## System-Wide Impact

| Surface | Change |
|---|---|
| `ExtractedFields` schema | Unchanged inner shape; now wrapped inside `ExtractedDocument`. |
| `Application` schema | Unchanged. Now produced by the extractor (server) instead of by the client. `crossCheckExpectations` synthesized server-side. |
| New `ExtractedDocument` schema | `{ application, label, provenance: Record<FieldPath, FieldProvenance> }` |
| Extractor prompt | Full rewrite for dual extraction + bboxes. `PROMPT_VERSION` → `'2026-06-10.v4'`. |
| OpenAI extractor module | Input is now a rendered PNG buffer; output is `ExtractedDocument`. |
| `VerificationReport` | + `provenance: Record<FieldPath, FieldProvenance>` |
| `ResultLine` Zod schema | Mirrors the new `VerificationReport`. |
| Verify route handler | Single-file multipart (`pdf` form field). Internal pipeline: render → extract → synthesize → verify → stream. |
| Result card | Replaced by `VerifierPane` (two-pane layout). |
| Scenario picker / home client | Loads `.pdf` only; phase reducer reshaped. |
| Eval harness | `cross-check-accuracy` evaluator updated to call the new extractor against PDFs instead of `.json + .jpg`. (Out-of-scope for this plan to MOVE — but the existing evaluator will break and must be updated or skipped to keep CI green.) |
| Langfuse traces | `provenance` field count + low-confidence count surfaced as trace attributes. |
| README | Full rewrite covering Tailwind/shadcn + cross-check + PDF verifier + bboxes. |

What's preserved exactly: cross-check engine + normalize, validation engine + rules, OpenAI extractor abstraction + factory pattern, password gate middleware, NDJSON streaming + stream-consumer, scenario PDFs.

What's removed: `application` JSON form field on `/api/verify`, separate label-image upload path, `staged-files-list.tsx` batch flow, current `result-card.tsx` single-pane layout, the old `route.scenarios.test.ts` setup (rewritten for PDF input).

---

## High-Level Technical Design

This is directional, not implementation specification. Implementer should treat it as context, not code to reproduce.

```
POST /api/verify (multipart form-data)
  └── pdf: File (application/pdf — single artifact)

  → read into Buffer
  → renderPageOne(buffer) → PNG Buffer (200 DPI, page 1 only)
  → extractor.extract(png) → ExtractedDocument { application, label, provenance }
  → synthesizeExpectations(extractedApplication) → Application (with crossCheckExpectations + labelOnlyExpectations filled in)
  → runVerification(application, extracted.label) → VerificationReport
  → emit NDJSON: ResultLine { status: 'ok', report: { overallStatus, crossCheck, fields, provenance } }
```

Component shape:

```
src/lib/
  pdf/
    render.ts                 ← renderPageOne(buffer): Promise<Buffer>
    render.test.ts
  extraction/
    types.ts                  ← + ExtractedDocument, FieldPath, FieldProvenance
    prompt.ts                 ← rewritten for dual extraction + bboxes; PROMPT_VERSION 2026-06-10.v4
    openai-extractor.ts       ← input is PNG buffer; returns ExtractedDocument
  application/
    loader.ts                 ← + synthesizeExpectations(form): Application
    loader.test.ts            ← +
  validation/
    types.ts                  ← VerificationReport gains provenance
  results/
    result-types.ts           ← ResultLineSchema mirrors new shape
  upload/
    phase-reducer.ts          ← state shape swap
  test-helpers/
    mock-extractor.ts         ← updated to return ExtractedDocument per scenario

src/components/
  pdf-viewer.tsx              ← NEW. 'use client'. react-pdf + bbox overlay layer.
  verifier-pane.tsx           ← NEW. Two-pane layout, selection state, click/hover wiring.
  scenario-picker.tsx         ← repointed to .pdf
  result-card.tsx             ← DELETED (or repurposed into verifier-pane's right side as a sub-component)
  staged-files-list.tsx       ← DELETED

src/app/
  api/verify/route.ts         ← rewritten
  home-client.tsx             ← phase reducer rewire + scenario load
```

---

## Implementation Units

### U1. Server-side PDF→PNG rendering

**Goal:** Take a PDF buffer, render page 1 to a PNG buffer at 200 DPI. Page 1 only — pages 2–5 are TTB instructions and ignored.

**Dependencies:** none (new isolated module).

**Files:**
- `src/lib/pdf/render.ts`
- `src/lib/pdf/render.test.ts`
- `package.json` — add `pdfjs-dist`, `canvas`

**Approach:**
- Import `getDocument` from `'pdfjs-dist/legacy/build/pdf.mjs'` (the legacy entry runs in Node).
- Set the Node worker explicitly (or use the `disableWorker: true` option appropriate for the bundled version) so it doesn't try to fetch a worker.
- `renderPageOne(pdfBuffer: Buffer | Uint8Array): Promise<Buffer>`:
  - Load the PDF, grab page 1.
  - Compute viewport at scale = 200 / 72 (default PDF DPI is 72) so the output is 200 DPI.
  - Create a `canvas` of viewport width × height.
  - `await page.render({ canvasContext, viewport }).promise`.
  - Return `canvas.toBuffer('image/png')`.
- No I/O beyond what's passed in; the route handler reads the file and passes buffer.

**Patterns to follow:**
- Existing pure-helper module style in `src/lib/` (no framework imports beyond what's strictly needed).
- Existing async + Buffer-returning helper signatures.

**Test scenarios:**
- Renders a known scenario PDF (e.g., `public/samples/applications/01-*/application.pdf`) to a PNG buffer whose magic bytes start with `\x89PNG`.
- Returned buffer length is reasonable (>50 kB for a 200 DPI letter page).
- Rendering an empty/corrupt buffer throws an explanatory error.
- Rendering twice from the same input produces deterministic output (byte-identical or close to it — `pdfjs` rasterization is deterministic; if there's any nondeterminism, fall back to checking dimensions).

**Verification:** Unit tests pass. `npm install` clean after adding deps.

---

### U2. `ExtractedDocument` schema + `FieldProvenance`

**Goal:** Define the wire shape for the new extractor return.

**Dependencies:** none (schemas).

**Files:**
- `src/lib/extraction/types.ts`
- `src/lib/extraction/types.test.ts`

**Approach:**
- Define `FieldProvenanceSchema`: `{ page: z.number().int().nonnegative(), bbox: { x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }, confidence: z.enum(['high','medium','low']) }`.
- Define `FieldPathSchema` as a Zod union of the literal strings enumerated in the HANDOFF Work order (13 application paths + 9 label paths, e.g. `'application.brandName'`, `'label.abv'`).
- Define `ExtractedDocumentSchema`: `{ application: ApplicationFormSchema (the bare form half, not full Application — see U3), label: ExtractedFieldsSchema (existing), provenance: z.record(FieldPathSchema, FieldProvenanceSchema) }`.
- `Application` itself (the loader-produced shape with cross-check + label-only expectations) stays where it is; the extractor returns only the form half. Naming: introduce `ApplicationFormSchema` for the bare form subset OR have the extractor return a slightly-narrower `ExtractedApplicationFormSchema`. Implementer picks the cleaner option as long as the existing `Application` shape continues to flow through cross-check unchanged.

**Patterns to follow:**
- Existing nullable-string + Zod `infer` pattern in `extraction/types.ts`.
- Cross-check's literal-union type style (`CrossCheckFieldId`).

**Test scenarios:**
- A valid `ExtractedDocument` payload parses.
- A payload with `provenance.x = 1.5` fails Zod validation (out of 0..1).
- A payload with an unknown FieldPath key fails Zod validation.
- A payload with `confidence: 'medium'` parses; with `confidence: 'unknown'` fails.
- Round-trip: parse → re-stringify → re-parse yields identical structure.

**Verification:** Unit tests pass. Type-check clean.

---

### U3. Rewrite extractor prompt for dual extraction + bboxes

**Goal:** A single prompt that elicits Application form + label fields + provenance bboxes from a page 1 PNG. This is the highest-leverage unit in the plan — spend disproportionate time here.

**Dependencies:** U2.

**Files:**
- `src/lib/extraction/prompt.ts` — bump `PROMPT_VERSION` to `'2026-06-10.v4'`. Rewrite SYSTEM_PROMPT.

**Approach:**
- Frame: "You are extracting structured data from a U.S. TTB COLA application (Form 5100.31) that has the affixed label artwork printed in the lower portion of page 1. Return a JSON object with three top-level keys: `application` (the form fields), `label` (the regulated fields visible on the affixed label artwork), and `provenance` (a map of field path → bounding box + confidence)."
- Be explicit about which keys belong to which side. Enumerate the 13 application paths and 9 label paths verbatim — the model's structured-output schema will already constrain this, but spelling them out in prose reduces drift.
- Bbox instructions:
  - Coordinates are normalized 0..1 with origin at TOP-LEFT of the page (matches PDF.js + react-pdf conventions; double-check at integration time).
  - `bbox` should tightly enclose the printed value (not its field label, not surrounding whitespace).
  - For multi-line fields (e.g., government warning), the bbox covers the smallest rectangle containing all lines.
  - `page` is always `0` for now (page 1, 0-indexed).
- Confidence instructions:
  - `'high'`: the value is clearly printed and the bbox lands exactly on it.
  - `'medium'`: value is clear but bbox placement is approximate (±5–10%).
  - `'low'`: value is hard to read, partially obscured, or bbox is a rough guess. The reviewer will be shown a dashed-border bbox in this case.
- Carry forward the existing label-side rules from the previous prompt: government warning verbatim, ABV format preservation, etc. These are well-tuned and shouldn't regress.
- Application-side rules:
  - Brand name, fanciful name: from Item 6/7 boxes on the form.
  - Class/type: from Item 5 (one of WINE / DISTILLED SPIRITS / MALT BEVERAGES — preserve the form's casing).
  - Applicant block (name, address, city, state): from Items 11–13.
  - Grape varietals + wine appellation: from the wine-only items; null for non-wine.
  - Serial number, plant registry number, application date, applicant signature name: from the appropriate items on the form.
- Wine handling: if `application.productType !== 'WINE'`, `application.grapeVarietals` and `application.wineAppellation` should both be null AND their provenance entries should be OMITTED from the provenance map.
- Output schema in the prompt (the structured-output JSON Schema) must match U2's Zod shape exactly.

**Patterns to follow:**
- Existing prompt's numbered-rule structure for clarity.
- Existing wording around "never invent values."

**Test scenarios:**
- `PROMPT_VERSION` is exactly `'2026-06-10.v4'` and differs from the previous `'2026-06-10.v3'`.
- The prompt mentions both `application.` and `label.` field paths explicitly.
- The prompt explicitly states normalized 0..1 coordinates with top-left origin.
- The prompt enumerates the three confidence tiers and the bbox-tightness rule.
- A snapshot test pins the prompt body so accidental edits are visible in diff.

**Verification:** Unit tests pass. Manual: review the prompt against the scenario 01 PDF mentally — does it tell the model exactly what to do?

---

### U4. OpenAI extractor consumes PNG, returns `ExtractedDocument`

**Goal:** Replace the existing image-and-MIME-buffer signature with a PNG-buffer signature; return the new shape.

**Dependencies:** U2, U3.

**Files:**
- `src/lib/extraction/openai-extractor.ts`
- `src/lib/extraction/openai-extractor.test.ts`

**Approach:**
- New signature: `extract(pngBuffer: Buffer): Promise<ExtractedDocument>`.
- Send the PNG as a `data:image/png;base64,...` content part (existing pattern; the previous extractor already encoded the file as base64).
- Use OpenAI structured-output mode with the JSON Schema derived from `ExtractedDocumentSchema` (Zod → JSON Schema using whatever the existing extractor uses, or write a hand-authored JSON Schema if it's simpler).
- Validate the response against `ExtractedDocumentSchema` and throw an `ExtractionError` (existing pattern) on failure.
- Trace attributes get `provenanceCount` and `lowConfidenceCount` for observability.
- Factory pattern (`getExtractor`) preserved; default returns the OpenAI implementation; tests can inject a mock.

**Patterns to follow:**
- Existing `getExtractor` factory.
- Existing structured-output call.
- Existing error wrapping + Langfuse trace pattern.

**Test scenarios:**
- Mocked OpenAI client returns a well-formed `ExtractedDocument` → `extract()` returns the parsed shape.
- Mocked OpenAI client returns malformed JSON → throws `ExtractionError` with descriptive message.
- Mocked OpenAI client returns a payload missing `provenance` → Zod validation surface throws.
- The base64 data URL passed to OpenAI has `image/png` MIME and matches the input buffer length when decoded.

**Verification:** Unit tests pass. (Live LLM smoke is U-evaluator territory.)

---

### U5. Application synthesis from extracted form

**Goal:** Turn the extractor's bare `application` (form fields only) into the full `Application` shape that downstream cross-check + rules expect — i.e., synthesize `crossCheckExpectations` + `labelOnlyExpectations` from the form fields.

**Dependencies:** U2.

**Files:**
- `src/lib/application/loader.ts` — add `synthesizeExpectations(form): Application`.
- `src/lib/application/loader.test.ts`

**Approach:**
- New exported helper `synthesizeExpectations(form: ExtractedApplicationForm): Application`.
- Maps form fields → `crossCheckExpectations`:
  - `brandName` ← `form.brandName`
  - `classType` ← `form.productType` (Item 5 broad product family; Item 7 fanciful name is not the class/type source)
  - `producer` ← `${form.applicant.name}, ${form.applicant.address}, ${form.applicant.city}, ${form.applicant.state}` (matching how the dataset already encodes it)
  - `wineVarietal` ← `form.grapeVarietals` (only when `productType === 'WINE'`)
  - `wineAppellation` ← `form.wineAppellation` (only when `productType === 'WINE'`)
  - Other fields per the existing dataset shape.
- Maps form fields → `labelOnlyExpectations`: copy the constants that the existing scenario JSONs encode (e.g., `governmentWarning.required: true`, etc.). These aren't derived from the form — they're regulatory constants. The simplest implementation has `synthesizeExpectations` hard-code the `labelOnlyExpectations` block since it's invariant across applications.
- `productType` comes directly from Item 5 when present; class/type comparison infers whether the label's specific designation belongs to that broad family.

**Patterns to follow:**
- Existing `parseApplication` shape — `synthesizeExpectations` returns the same `Application` type, just produced from a different source.

**Test scenarios:**
- A synthesized application from scenario 01's form fields equals the existing `01-*/application.json` (modulo whitespace) when compared field-by-field.
- A non-wine form has `crossCheckExpectations.wineVarietal === undefined` AND `wineAppellation === undefined`.
- A wine form has both populated.
- The synthesized shape parses cleanly via `parseApplication` (i.e., it's a valid `Application`).

**Verification:** Unit tests pass. Synthesis covers all 5 scenarios.

---

### U6. `/api/verify` route accepts PDF

**Goal:** Rewrite the route handler to accept a single PDF, render page 1, extract, synthesize, verify, stream NDJSON with provenance.

**Dependencies:** U1, U4, U5.

**Files:**
- `src/app/api/verify/route.ts`
- `src/app/api/verify/route.test.ts`

**Approach:**
- Multipart form-data with a single `pdf` field; reject with `400` if absent or not `application/pdf`.
- Read into `Buffer`, run `renderPageOne(buffer) → png`.
- Call `extractor.extract(png) → extractedDoc`.
- Call `synthesizeExpectations(extractedDoc.application) → application`.
- Call `runVerification(application, extractedDoc.label) → report`.
- Emit a single NDJSON OK line carrying `report` (now with `provenance` merged in).
- Error handling: render failures, extraction failures, and verification failures each emit an explicit error line with `scrubError` applied.
- Tracing: spans wrap each stage (`render`, `extract`, `synthesize`, `verify`); `lowConfidenceCount` + `crossCheckStatus` continue to be attributes.

**Patterns to follow:**
- Existing `errorResponse` helper.
- Existing `withRequestSpan` + per-stage span attributes.
- Existing NDJSON encoding (newline-delimited JSON, one `ResultLine` per chunk).

**Test scenarios:**
- POST without `pdf` field → 400 with explicit message.
- POST with a non-PDF MIME (e.g., `image/png`) → 400.
- POST with a malformed PDF → emits an error line with the render failure message.
- POST with a valid scenario 01 PDF + mocked extractor → 200 stream with `report.crossCheck.overallStatus === 'match'` and `report.provenance` populated.
- POST with a valid scenario 03 PDF + mocked extractor → 200 stream with wineVarietal + wineAppellation `mismatch`.

**Verification:** Route tests pass. Smoke against scenario 01 returns `compliant`.

---

### U7. `ResultLine` schema gains `provenance`

**Goal:** Make the NDJSON contract aware of `provenance` so the client validates it.

**Dependencies:** U2, U6.

**Files:**
- `src/lib/results/result-types.ts`
- `src/lib/results/result-types.test.ts`

**Approach:**
- `VerificationReportSchema` (or whatever the result-side mirror is) gains `provenance: z.record(FieldPathSchema, FieldProvenanceSchema)`. Re-export the schemas from `extraction/types.ts` rather than redefining them.
- `ResultLineSchema` shape is unchanged at the top level; just the nested `report` is richer.

**Patterns to follow:**
- Existing `ResultLineSchema` discriminated union.

**Test scenarios:**
- A `ResultLine` with full `report.provenance` parses cleanly.
- A `ResultLine` whose provenance has an out-of-bounds bbox fails validation.
- A `ResultLine` without `provenance` fails validation (provenance is required, not optional).
- A `ResultLine` with status `'error'` does NOT require `provenance`.

**Verification:** Unit tests pass.

---

### U8. PDF viewer component with bbox overlay

**Goal:** A `react-pdf`-based viewer that renders all 5 pages of the uploaded PDF and overlays bbox highlights on the page where the selected field lives.

**Dependencies:** U7 (consumes ResultLine shape — but only the provenance keys).

**Files:**
- `src/components/pdf-viewer.tsx` — `'use client'`
- `src/components/pdf-viewer.test.tsx`
- `public/pdfjs/pdf.worker.min.mjs` — copy in via build step OR `postinstall` script
- `package.json` — add `react-pdf`

**Approach:**
- `'use client'` directive at the top.
- Import `react-pdf` lazily via `next/dynamic` so the bundle doesn't load until upload.
- Component shape: `<PdfViewer pdfBlob={Blob | File} provenance={Record<FieldPath, FieldProvenance>} selectedFieldId={FieldPath | null} onSelectField={(id) => void} />`.
- Renders each page in a `<Page>` element; observes which page is active in scroll position.
- For each page, an overlay layer absolutely-positioned over the rendered page renders bboxes:
  - Each bbox is a `<div>` positioned at `left: x*pageWidth, top: y*pageHeight, width: w*pageWidth, height: h*pageHeight`.
  - Selected bbox: solid border, accent color, semi-transparent fill.
  - Non-selected bboxes are not rendered by default (would be visual noise) — they only render on hover via the corresponding row in the right pane, OR optionally on a global "show all bboxes" toggle (defer this; not required for v1).
  - Low-confidence bboxes (`confidence === 'low'`): dashed border, muted color.
- When `selectedFieldId` changes, scroll the page containing that field into view smoothly.
- PDF.js worker setup: copy the worker into `public/pdfjs/` and set `pdfjs.GlobalWorkerOptions.workerSrc` to the public URL. Document the postinstall step in README.

**Patterns to follow:**
- Existing client-component patterns (`'use client'` + state hooks).
- Tailwind utility classes for the overlay positioning.

**Test scenarios:**
- Renders 5 pages for a 5-page PDF.
- Renders the selected bbox on the correct page with the correct normalized coordinates (mock the page dimensions; assert on rendered `left`/`top` style).
- Low-confidence bbox has the dashed border class.
- Selecting a field whose page differs from the current scroll position triggers a scroll into view (assert on `scrollIntoView` mock).
- No bbox renders for a field whose `selectedFieldId` doesn't match.

**Verification:** Component tests pass. Manual: scenario 01 PDF loads, all 5 pages visible, clicking a row in the right pane (U9 wiring) highlights the right region on the page.

---

### U9. Two-pane verifier layout

**Goal:** New top-level result component implementing the PDF-left / results-right layout with click/hover wiring and selection state.

**Dependencies:** U7, U8.

**Files:**
- `src/components/verifier-pane.tsx`
- `src/components/verifier-pane.test.tsx`

**Approach:**
- Layout: CSS grid, 60/40 split on desktop (`md:grid-cols-[60%_40%]`), stacked on mobile (`grid-cols-1`). PDF on left, results on right.
- State: `const [selectedFieldId, setSelectedFieldId] = useState<FieldPath | null>(null)`. One field at a time; clicking the same field deselects.
- Right pane contains:
  - Verdict + summary dots row at the top (existing pattern: 1 XC dot + 6 rule dots) — pulled from current `result-card.tsx` largely unchanged, just wired into the new layout.
  - Cross-check section (existing pattern): each field row is now a clickable button. `aria-pressed` reflects selection. Click → `setSelectedFieldId('application.brandName')` (or whichever field path corresponds).
  - Label rules section (existing pattern): each rule row clickable → selects the label field bbox that drove the rule (e.g., the government-warning rule selects `label.governmentWarning`).
- Left pane mounts `<PdfViewer ...>` with the selection state propagated.
- Hover-to-highlight: on hover of a row, set a transient `hoveredFieldId` and pass it to `PdfViewer` as `selectedFieldId` if no actual selection exists. (Or pass both and let PdfViewer prefer the explicit selection — implementer decides.)
- Visually:
  - Selected row: accent background.
  - Hover row: subtle background.

**Patterns to follow:**
- Existing `result-card.tsx` accordion + section structure for the right pane content.
- Existing accent colors / Tailwind tokens.

**Test scenarios:**
- Clicking a cross-check row sets selection to the corresponding `application.*` field path.
- Clicking the same row again clears selection.
- Clicking a rule row selects the corresponding `label.*` field path.
- The PDF viewer receives the correct `selectedFieldId` prop.
- Renders without crashing when `provenance` is missing a key (defensive — the field row should still be clickable but the viewer just doesn't show a bbox).
- Mobile layout (narrow viewport) stacks correctly — PDF above, results below.

**Verification:** Component tests pass. Manual smoke against all 5 scenarios.

---

### U10. Scenario picker swap to PDF

**Goal:** Demo dropdown loads `.pdf` only; the rest of the flow consumes the PDF identically to a manual upload.

**Dependencies:** U6 (route shape), U11 (reducer shape).

**Files:**
- `src/lib/application/load-scenario.client.ts`
- `src/components/scenario-picker.tsx`
- `src/app/home-client.tsx`

**Approach:**
- `load-scenario.client.ts` exports `loadScenarioPdf(slug): Promise<File>` — fetches `/samples/applications/{slug}/application.pdf`, wraps the blob as a `File` named `application.pdf` with `application/pdf` MIME.
- `scenario-picker.tsx`: hardcoded 5-slug list (existing). On selection: call `loadScenarioPdf` → dispatch new action `SCENARIO_LOADED_PDF` to phase reducer → reducer transitions to "ready to verify" with the file populated.
- `home-client.tsx`: rewire the dispatch + state-consuming UI to the new shape; remove the `application + files` state references.
- Remove the old `loadScenario` (the one that fetched JSON + JPG).

**Patterns to follow:**
- Existing client-side fetch + Blob→File pattern.
- Existing dropdown UX (select element, resets to `""` after selection).

**Test scenarios:**
- Selecting scenario 01 fetches the PDF and dispatches `SCENARIO_LOADED_PDF` with a `File` whose `type === 'application/pdf'` and `size > 0`.
- A failed fetch (404) surfaces an error toast, does not corrupt state.
- After selection, the dropdown resets to `""`.
- Manual PDF upload still works alongside scenario selection.

**Verification:** Component tests pass. Manual: pick each of the 5 scenarios, observe the file populates and verify is enabled.

---

### U11. Phase reducer for PDF flow

**Goal:** Rework the upload state model from `application + files[]` to `pdfFile + extractedDocument + selectedFieldId`.

**Dependencies:** none (pure reducer change; consumers updated in U9/U10).

**Files:**
- `src/lib/upload/phase-reducer.ts`
- `src/lib/upload/phase-reducer.test.ts`

**Approach:**
- New state shape:
  ```ts
  type Phase =
    | { kind: 'idle' }
    | { kind: 'pdf-ready'; pdfFile: File }
    | { kind: 'verifying'; pdfFile: File }
    | { kind: 'verified'; pdfFile: File; report: VerificationReport }
    | { kind: 'error'; pdfFile: File | null; message: string };
  ```
- Actions: `PDF_UPLOADED`, `SCENARIO_LOADED_PDF`, `VERIFY_STARTED`, `VERIFY_RESULT_RECEIVED`, `VERIFY_FAILED`, `RESET`.
- `selectedFieldId` lives in component state in `VerifierPane`, NOT in the reducer — selection is UI state, not pipeline state. (If this turns out to span components in practice, lift it; otherwise keep it local.)

**Patterns to follow:**
- Existing reducer style (discriminated-union state + action types).
- Existing test pattern: one test per (state, action) transition.

**Test scenarios:**
- `PDF_UPLOADED` from `idle` → `pdf-ready`.
- `SCENARIO_LOADED_PDF` from `idle` → `pdf-ready`.
- `SCENARIO_LOADED_PDF` from `verified` → `pdf-ready` (loading a new scenario clears the prior result).
- `VERIFY_STARTED` from `pdf-ready` → `verifying`.
- `VERIFY_RESULT_RECEIVED` from `verifying` → `verified` with the report attached.
- `VERIFY_FAILED` from `verifying` → `error` with the file preserved.
- `RESET` from any state → `idle`.

**Verification:** Reducer tests pass. Old reducer state references are fully removed from `home-client.tsx`.

---

### U12. 5-scenario integration test rewrite

**Goal:** A single test file that runs all 5 scenarios through the new route handler with a mocked extractor returning deterministic `ExtractedDocument`s.

**Dependencies:** U1–U11.

**Files:**
- `src/app/api/verify/route.scenarios.test.ts`
- `src/lib/test-helpers/mock-extractor.ts` — extended to return `ExtractedDocument` per scenario.

**Approach:**
- For each of the 5 scenarios, define a deterministic `ExtractedDocument` that produces the expected truth-table outcome:
  - 01 Ridge Creek: clean form + clean label → all `match`.
  - 02 Silver Birch: form brand `'Silver Birch'`, label brand `'Silver Birch Premium'` → brand `mismatch`.
  - 03 Hawthorne Cabernet: form `wineVarietal: 'Cabernet'`, label `wineVarietal: 'Merlot'` (etc) → wineVarietal + wineAppellation `mismatch`.
  - 04 Ironwood IPA: all cross-check `match`, but `label.governmentWarning: null` → rule fail.
  - 05 Calypso Sands: form producer `'Calypso Sands ...'`, label producer `'Bottled by Tropical Spirits ...'` → producer `mismatch` + ABV rule fail.
- `vi.mock` the extractor factory; the mock branches on a marker (e.g., a fixture-injected `scenarioId` smuggled through a custom mock or chosen per-test).
- For each scenario:
  - Build a `Request` with the scenario's `application.pdf` as a `File`.
  - Invoke the route's `POST` directly.
  - Parse NDJSON.
  - Assert `report.overallStatus`, the cross-check field results, the rule results, AND that `report.provenance` has entries for the fields the mock injected.

**Patterns to follow:**
- Existing `route.scenarios.test.ts` for the Request-construction + NDJSON-parsing pattern (the previous version is being replaced but the shape is reusable).

**Test scenarios:**
- All 5 scenarios produce their expected verdict.
- Provenance keys exist for every field the mock populated.
- Negative control: an all-null mock extractor produces `not_on_label` across the cross-check (sanity that the test isn't tautological).

**Verification:** `npx vitest run src/app/api/verify/route.scenarios.test.ts` passes. No live LLM calls.

---

### U13. README rewrite

**Goal:** README accurately reflects the current architecture — Tailwind + shadcn (prior pivot), cross-check engine, PDF-only verifier, vision-LLM bboxes, two-pane UI.

**Dependencies:** U1–U12.

**Files:**
- `README.md`

**Approach:**
- Sections: What this is → How it works (architecture diagram in prose or ASCII) → Running locally → Demo flow (with each scenario's expected outcome) → Architecture decisions + tradeoffs → What's deferred.
- Cover: PDF input contract, server-side render, single vision call, bbox provenance + confidence tiers, cross-check + rules composition, two-pane UI, password gate, NDJSON streaming.
- Cost note: one vision call against a 200 DPI page 1 PNG is ~$0.02–0.04 per verify. Surface this.
- Remove all USWDS / Section 508 references from the prior version.
- Reference both plan docs (`2026-06-10-001` cross-check, `2026-06-10-002` PDF verifier) for the evolutionary story.

**Patterns to follow:**
- Existing README structure where it still applies.

**Test scenarios:**
- Manual review only (markdown docs aren't unit-tested). Spot-check that every CLI command in "Running locally" actually works.

**Verification:** README renders cleanly. `npm run dev`, `npm run test`, `npm run eval`, and the demo flow described in the README all work as documented.

---

## Test Strategy

| Layer | Coverage |
|---|---|
| Unit (pdf/render) | Known PDF → PNG; bad input throws; deterministic. |
| Unit (extraction types) | New `ExtractedDocument` + `FieldProvenance` schemas, valid + invalid shapes. |
| Unit (prompt) | `PROMPT_VERSION` correct; snapshot test on prompt body. |
| Unit (openai-extractor) | Mocked OpenAI: well-formed response, malformed JSON, missing fields, base64 data URL shape. |
| Unit (application/loader synth) | All 5 scenarios synthesized from their form-field subset equal the canonical Application shape. |
| Unit (results) | `ResultLine` round-trip with provenance; invalid shapes rejected. |
| Unit (phase-reducer) | One test per (state, action) transition. |
| Component (pdf-viewer) | 5-page rendering, bbox positioning, low-confidence styling, scroll-into-view on selection change. |
| Component (verifier-pane) | Click selection, click-again deselection, hover, mobile stacking, defensive missing-provenance handling. |
| Component (scenario-picker) | Scenario load happy path, 404 toast, dropdown reset. |
| Route | Missing/invalid PDF → 400; valid PDF + mocked extractor → 200 NDJSON with provenance. |
| Integration (scenarios) | All 5 scenarios through the in-process route handler with a mocked extractor — truth table holds. |
| Eval (live LLM, optional) | `cross-check-accuracy` evaluator updated to consume PDFs through the new pipeline; gated on `OPENAI_API_KEY`. |

Existing tests must continue to pass where they don't reference the removed JSON+image path. Tests that DO reference the removed path must be migrated (handler tests, route.scenarios) or deleted (`staged-files-list` tests).

---

## Verification Strategy

Plan is complete when:

1. All new unit tests pass.
2. All preserved existing unit tests still pass (target: ≥260 — minus removed tests for removed surfaces, plus new tests for new surfaces; net expected ≥280).
3. `npx tsc --noEmit` is clean.
4. `npx vitest run src/app/api/verify/route.scenarios.test.ts` passes — the 5-scenario integration test exercises the full PDF pipeline end-to-end.
5. `next build` succeeds with no errors and no unexpected bundle size regression on `/login` (the lean route must stay lean despite `react-pdf` being installed).
6. Manual smoke: log in, pick each scenario, observe the two-pane verifier:
   - 01 Ridge Creek → all green (cross-check + rules).
   - 02 Silver Birch → brand row amber, click it, PDF highlights the form brand box.
   - 03 Hawthorne → varietal + appellation amber, click each, PDF highlights both spots.
   - 04 Ironwood IPA → green cross-check, amber government-warning rule, click it, PDF highlights the label warning region (or the absence of it).
   - 05 Calypso → producer amber, ABV rule amber.
7. Manual smoke for low-confidence: at least one scenario produces a low-confidence bbox; the UI renders it with a dashed border + muted color. (If GPT-4o never returns `'low'` on a clean test PDF, force one in the integration test to verify the rendering path; production use will hit it organically on noisier PDFs.)
8. Live LLM smoke against scenario 01 via the real extractor: `report.crossCheck.overallStatus === 'match'`, every `provenance` entry has `confidence`, bbox math feels right (visually).
9. README accurately documents the current state; every CLI command in the README works.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Vision-LLM bbox drift** — model returns bboxes 10–20% off, breaking the "click to see the source" demo moment. | High | High | (a) Schema requires `confidence` so we can dashed-border the bad ones. (b) Snapshot scenario 01 first as a smoke test — if a clean field's bbox drifts >15%, activate the AcroForm-widget-snap fallback (form fields only). (c) Iterate the prompt's bbox instructions if widespread drift, before reaching for the fallback. |
| `pdfjs-dist` in Node has historically been a headache (worker setup, native deps via `canvas`). | Medium | Medium | Use the documented `legacy/build/pdf.mjs` entry. `canvas` ships prebuilt binaries for darwin-arm64 (current dev box). If install fails, fall back to `node-canvas` or `@napi-rs/canvas` (drop-in). Pin a known-working version. |
| `react-pdf` bundle weight (~250 kB) lands on `/login` or initial paint. | Medium | Medium | `next/dynamic` import the viewer component; verify with `next build` that `/login` chunk doesn't grow. |
| Single vision call returning ~22 fields + ~22 bboxes is at the edge of GPT-4o's structured-output reliability. | Medium | Medium | If the model truncates or drops fields, structured-output mode will Zod-fail loudly. Mitigation A: simplify provenance to only the most demo-critical fields (~10) and surface the rest with no bbox. Mitigation B: split into two calls (form first, label second) — only if necessary; doubles cost. |
| Synthesizing `crossCheckExpectations` from the extracted form drifts from how the existing `parseApplication` shaped them, breaking cross-check downstream. | Medium | High | U5's tests assert the synthesized shape equals (or is structurally identical to) the canonical scenario `application.json` for all 5 scenarios. CI will catch drift. |
| Removing the JSON-input path breaks the existing eval evaluator `cross-check-accuracy` which still expects `.json + .jpg`. | High | Low | Update the evaluator to consume PDFs through the new pipeline as part of this plan (treat as a sub-task of U6 or U12), OR mark it skipped pending a follow-up. Prefer updating since the dataset already ships PDFs. |
| `PROMPT_VERSION` left at `'2026-06-10.v3'` would conflate old + new traces in Langfuse. | Low | Medium | Explicit U3 task + snapshot test pinning the new version string. |
| Time budget: HONEST 4–6 hour estimate, due date is TODAY (2026-06-10). | High | High | U1–U7 (server pipeline) is the critical path and must land first. U8–U11 (UI) is the demo path. U13 (README) and the eval-evaluator migration are last. If pinched, ship server + UI for the 5 scenarios, defer README polish to a follow-up commit. |

---

## Dependencies / Prerequisites

- `public/samples/applications/0N-*/application.pdf` exists for all 5 scenarios. ✅ Already shipped.
- `OPENAI_API_KEY` in `.env.local` for live LLM smoke (optional for CI).
- New runtime deps: `pdfjs-dist`, `canvas`, `react-pdf`. All published, stable.
- `feat/cross-check` is intact and remains the fallback branch.

---

## Sequencing Notes

- U1 and U2 can run in parallel (both isolated).
- U3 depends on U2.
- U4 depends on U2 + U3.
- U5 depends on U2.
- U6 depends on U1 + U4 + U5.
- U7 depends on U2 (and consumers in U6).
- U8 depends on U7 (consumes provenance shape) and `react-pdf` install.
- U9 depends on U7 + U8.
- U10 depends on U6 (route shape) + U11 (reducer shape).
- U11 is independent.
- U12 depends on U1–U11.
- U13 depends on everything else.

Suggested commit order: U1 → U2 → U3 → U4 → U5 → U7 → U6 → U11 → U10 → U8 → U9 → U12 → U13. Each is a clean atomic commit. The server path lands first; UI lands second; README last.

---

## Carry-forward for next handoff

If anything in this plan slips, capture:
- Whether the AcroForm-widget-snap fallback (U6 risk row) was activated.
- Any prompt iterations needed to stabilize bbox quality.
- The actual GPT-4o cost-per-verify measured against scenario 01.
- Whether `next/dynamic` import of `react-pdf` actually kept `/login` lean.

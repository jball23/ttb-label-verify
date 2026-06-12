# TTB Label Verification

Prototype for the U.S. Department of the Treasury / Alcohol and Tobacco Tax and Trade Bureau. A TTB reviewer uploads one **COLA application PDF** (TTB Form 5100.31) with the affixed label artwork. The system reads both the form and the label in a single GPT-4o vision call, cross-checks them, runs the six TTB label rules, and shows the reviewer a two-pane verifier with **clickable bounding-box provenance** — every extracted value points back to its location on the source document.

Built over a multi-day take-home window. Production-shaped, not production-ready.

---

## What it does

1. Reviewer uploads `application.pdf` — a filled COLA application with the affixed label artwork printed on page 1.
2. Server renders page 1 to a 200 DPI PNG using `pdfjs-dist` + `@napi-rs/canvas`.
3. One GPT-4o (`gpt-4o-2024-11-20`) vision call returns:
   - the **application form** fields (brand, class, applicant, etc.)
   - the **label** fields (brand, ABV, government warning verbatim, net contents, class, producer, country, wine fields)
   - a **provenance** map of `field-path → { page, bbox, confidence }` so every value points back to a region on the page.
4. Server synthesizes the canonical `Application` shape from the extracted form, then runs:
   - **Cross-check engine** (per-field strict: brand, class/type, producer, country, wine varietal, wine appellation) using a deterministic normalizer + alias map.
   - **Six TTB label-only rules** (brand, ABV format, government warning verbatim, net contents, class/type, producer & origin).
5. Verdict: `compliant` iff every cross-check field matches AND no rule fails. Otherwise `needs_review`.
6. Result streams back as NDJSON. The UI renders a **two-pane verifier**:
   - **Left**: PDF viewer (react-pdf) with bbox overlay on the selected field.
   - **Right**: verdict + summary dots + cross-check section + rule rows. Every row is clickable → highlights the source on the PDF. Low-confidence bboxes render with a dashed border.

---

## Quick start

Requirements: Node 20+ (developed against Node 26), npm.

```bash
git clone <repo-url>
cd ttb-label-verify
npm install
cp .env.example .env.local
# Edit .env.local: OPENAI_API_KEY (DATABASE_URL optional)
npm run dev
```

Open <http://localhost:3000>.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server with HMR |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm test` | Vitest — 300 tests across pdf rendering, extraction, cross-check, validation, results, exports, reducer, route |
| `npm run typecheck` | `tsc --noEmit` — strict mode, no `any` |
| `npm run lint` | `next lint` |
| `npm run eval` | Legacy LLM eval suite against label images (needs real label images on disk; gated on `OPENAI_API_KEY`) |

### Demo

**Pick one of the 5 demo scenarios** from the dropdown or drop a COLA PDF. Then click **Verify**.

Five scenarios ship under `public/samples/applications/`:

| # | Scenario | What you should see |
|---|---|---|
| 01 | Ridge Creek Bourbon | All cross-check rows green. Verdict typically `needs_review` because of a pre-existing ABV-rule edge case on `"45% ALC/VOL (90 PROOF)"` plus government-warning bold uncertainty. |
| 02 | Silver Birch Vodka | Brand row amber — label reads "Silver Birch Premium", form says "Silver Birch". |
| 03 | Hawthorne Cabernet | Wine varietal + appellation amber — label shows Merlot / Sonoma County, form says Cabernet Sauvignon / Napa Valley. |
| 04 | Ironwood IPA | Green cross-check, amber government-warning rule — label is missing the warning text. |
| 05 | Calypso Rum | Producer mismatch (label says "Tropical Spirits, San Juan PR" vs form "Calypso Sands, Miami FL") + ABV rule fails on "80 PROOF" only. |

Click any value in the right pane to highlight where it came from on the source PDF.

---

## Architecture

```
POST /api/verify  (multipart, one `pdf` field)
  → pdf/render.ts            renderPageOne(buffer) → 200 DPI PNG
  → extraction/openai-extractor.ts
                              extract(png) → ExtractedDocument
                              ({ application, label, provenance })
  → application/loader.ts    synthesizeExpectations(form) → Application
  → validation/engine.ts     runVerification(application, label, provenance) → VerificationReport
                              ├── cross-check/engine.ts   runCrossCheck(...)
                              └── validation/rules/...    six TTB rules
  → results/result-types.ts  ResultLine — NDJSON wire shape
  → home-client.tsx          consumes the stream
  → verifier-pane.tsx        two-pane layout
       ├── pdf-viewer.tsx    react-pdf + bbox overlay (dynamic-imported)
       └── (right pane)      verdict + cross-check + rules sections
```

### Key decisions

- **One vision call, three structures.** Splitting form + label into two calls doubles latency and cost without accuracy gain — the model sees the whole page either way.
- **Vision-LLM-only bboxes.** No OCR, no Document AI, no Textract. The schema requires `confidence: 'high' | 'medium' | 'low'` and the UI surfaces `'low'` with a dashed border so the reviewer knows to eyeball. AcroForm-widget snap is a documented escape hatch (`scripts/inspect-form.mjs` + `scripts/calibrate.mjs`) we did not need to activate against the 5 scenarios.
- **Cross-check is its own module, not a Rule.** Rules take only `ExtractedFields`; cross-check needs both `Application` and `ExtractedFields`. Sibling module keeps the rule list's Open/Closed property.
- **Cross-check granularity is per-field strict.** Any single mismatch flips the overall verdict. Tolerance lives inside the comparator (corporate-suffix strip, token-set producer match), not in the verdict aggregation.
- **Deterministic extractor settings.** `temperature: 0`, `seed: 1` — same PDF + prompt yields the same extraction across runs.
- **Server-side render at 200 DPI.** Consistent token budget for the model, single-frame focus so it isn't distracted by the 4 pages of TTB instructions.
- **`PROMPT_VERSION` is bumped on every substantive prompt change** (currently `'2026-06-10.v4'`) so Langfuse traces don't conflate revisions.

### Stack

- **Next.js 15** App Router, React 19. Tailwind 4 + shadcn-style components.
- **OpenAI** `gpt-4o-2024-11-20` via the `openai` SDK with structured-output (Zod → JSON Schema).
- **pdfjs-dist 4.x** + `@napi-rs/canvas` for server-side page rendering.
- **react-pdf 9.x** for the client viewer (dynamically imported so `/login` stays lean).
- **Zod 3** for every wire boundary — extractor response, application JSON, NDJSON result line.
- **Langfuse** for prompt/trace observability when keys are set; no-op otherwise.
- **Vitest** for unit + integration tests. No live LLM in CI.

### File map

```
src/lib/
  pdf/render.ts              page-1 PNG render
  extraction/types.ts        ExtractedDocument, FieldProvenance, FieldPath, ProvenanceMap
  extraction/prompt.ts       dual-extraction prompt (PROMPT_VERSION 2026-06-10.v4)
  extraction/openai-extractor.ts
  extraction/factory.ts      DI for provider swap (openai / azure-openai)
  application/types.ts       Application Zod schema (canonical form + cross-check expectations)
  application/loader.ts      parseApplication + synthesizeExpectations
  application/load-scenario.client.ts   client-side scenario PDF loader
  cross-check/engine.ts      runCrossCheck
  cross-check/normalize.ts   token-set, corporate-suffix strip, class-type aliases
  validation/engine.ts       runVerification (cross-check ∘ rules)
  validation/rules/...       six TTB rule modules
  results/result-types.ts    ResultLineSchema (Zod wire contract)
  upload/phase-reducer.ts    upload state machine
  observability/             Langfuse client + span helpers

src/components/
  pdf-viewer.tsx             react-pdf + bbox overlay, dynamically imported
  verifier-pane.tsx          two-pane layout, click/hover wiring, selection state
  scenario-picker.tsx        demo dropdown
  result-card.tsx            legacy single-pane card (kept for the inspector)

src/app/
  api/verify/route.ts        POST handler: render → extract → synthesize → verify → stream
  home-client.tsx            top-level state machine
  page.tsx                   server entry

public/
  pdf.worker.min.mjs         pdfjs worker for the client viewer (copied at install time)
  samples/applications/      5 scenario PDFs
```

---

## Cost

A single verify call against a 200 DPI page-1 PNG of a 1.7 MB COLA PDF runs ~**$0.02–$0.04** on `gpt-4o-2024-11-20` and takes ~**10–15s** end-to-end (most of that is the vision call). PROMPT_VERSION + per-trace cost surface in Langfuse when keys are set.

---

## Testing

`npm test` runs 300 tests against a clean tree:

- `src/lib/pdf/render.test.ts` — renders a real scenario PDF, asserts PNG magic bytes, deterministic dimensions.
- `src/lib/extraction/types.test.ts` — schemas (ExtractedFields, ExtractedDocument, FieldPath, FieldProvenance).
- `src/lib/extraction/prompt.test.ts` — version pin, snapshot of key prompt invariants.
- `src/lib/application/loader.test.ts` — `parseApplication` + `synthesizeExpectations` across all 5 scenarios.
- `src/lib/cross-check/` — engine + normalize on the truth table.
- `src/lib/validation/` — rules + aggregation.
- `src/lib/results/` — Zod round-trip, NDJSON stream consumer.
- `src/lib/upload/phase-reducer.test.ts` — all (state, action) transitions.
- `src/app/api/verify/route.test.ts` — happy path, missing/wrong field, empty file, render failure, extractor failure.
- `src/app/api/verify/route.scenarios.test.ts` — **the 5-scenario truth table** through the in-process route with a mocked extractor.

No live LLM calls in CI. The eval evaluator (`npm run eval`) is the legacy label-image path and is gated on `OPENAI_API_KEY`; it predates the PDF pivot and needs an update to consume PDFs through the new pipeline.

---

## Deployment notes

- `next.config.mjs` lists `pdfjs-dist` and `@napi-rs/canvas` under `serverExternalPackages` so the native canvas binary and pdfjs worker file aren't pulled into the webpack bundle. `react-pdf` is in `transpilePackages` so its client-side ESM init runs cleanly under the Next bundler.
- The pdfjs worker is shipped under `public/pdf.worker.min.mjs`. The PdfViewer component points `pdfjs.GlobalWorkerOptions.workerSrc` at `/pdf.worker.min.mjs`.
- Server-side render sets `GlobalWorkerOptions.workerSrc` via `createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')` so pdfjs can spin up its parser inside the route at runtime.
- Demo password gate lives in `middleware.ts` (signed-cookie session, `jose`).

---

## What this prototype isn't

- **Not a COLAs system integration.** Standalone verifier; the COLAs system is out of scope.
- **Not multi-label aware.** Each verify is one PDF, one cross-check pass. The COLA form allows multiple labels (front + back + neck); the prototype is 1:1.
- **No persistence.** No DB, no audit trail, no reviewer accounts.
- **No reviewer override.** Mismatches surface as-is; there is no "mark this acceptable" UI.
- **No production hardening.** No rate limiting, no anti-abuse, no privilege separation. The password gate is a demo affordance.

---

## Project history

Two design pivots shaped the current architecture. See:

- `docs/plans/2026-06-09-001-feat-ttb-label-verify-plan.md` — initial label-only verifier.
- `docs/plans/2026-06-10-001-feat-cross-check-plan.md` — pivot to application + label cross-check (kept on `feat/cross-check` branch as a fallback).
- `docs/plans/2026-06-10-002-feat-pdf-verifier-plan.md` — pivot to single-PDF input + bounding-box provenance (this branch).

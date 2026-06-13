# TTB Label Verification

Prototype for reviewing U.S. Alcohol and Tobacco Tax and Trade Bureau COLA
application PDFs. A reviewer uploads one or more filled TTB Form 5100.31 PDFs,
the system reads only the form fields and affixed label artwork needed for the
review, highlights the source regions it used, and routes each item through:
**Queue → Approved / Rejected → Finalized → Archive**.

Production-shaped, not production-hardened.

---

## What it does

1. Reviewer selects one or more real COLA PDFs from `public/samples/cola/` or
   drops their own filled COLA PDFs onto the queue.
2. The client processes uploads one PDF at a time so normal provider limits do
   not turn a batch upload into rate-limit errors.
3. `/api/verify` renders the relevant PDF pages at 200 DPI with `pdfjs-dist`
   and `@napi-rs/canvas`.
4. The server parses Form 5100.31's text layer first, reading only fields that
   matter for this review: source/product type, brand, fanciful/class name,
   applicant/producer context, grape varietal, and wine appellation.
5. Label OCR runs on masked label-artwork images, not on the surrounding form
   chrome. Tesseract supplies word-level bboxes for highlightable fields.
6. OpenAI VLM fallback is used selectively for fields Tesseract cannot read
   confidently. Fallback values are text-only; the UI marks them as AI-sourced
   and does not pretend to have an exact source box.
7. The rule engine evaluates the label requirements and folds in only the
   application comparisons needed to assess the label.

The detail view keeps the review compact: one **TTB label rules** panel on the
left and the original PDF on the right. Click a rule row to jump to the source
page and bbox when one is available.

---

## Quick start

Requirements: Node 20+ (developed against Node 26), npm.

```bash
git clone <repo-url>
cd ttb-label-verify
npm install
cp .env.example .env.local
# Edit .env.local. OPENAI_API_KEY is optional for local OCR-only runs,
# but recommended so hard fields can use the VLM fallback.
npm run dev -- -p 3002
```

Open <http://localhost:3002>. The app has no login; the homepage is the queue.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server with HMR |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm test` | Vitest unit/integration suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `next lint` |
| `npm run eval` | Legacy label-image eval suite under `evals/` |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:reset -- --yes` | Drop and recreate every table |

---

## Reviewer Flow

The homepage has four tabs:

| Tab | What's in it |
|---|---|
| **Queue** | In-flight uploads. Rows leave automatically when verification finishes. |
| **Approved** | AI verdict is `compliant` or `needs_review`; default human action is Approve. |
| **Rejected** | AI verdict is `non_compliant`; default human action is Reject. |
| **Finalized** | Human-reviewed rows that are not archived yet. They can still be revised here. |

Use **Archive Selected** from the Finalized tab to move reviewed rows into
`/applications`, the archive. Once a row is archived, its final decision is
locked.

---

## Verdict Model

Only the Government Warning rule auto-routes to Rejected. Everything else is
reviewer judgment.

| Rule outcome | Status | Verdict contribution | Where it lands |
|---|---|---|---|
| Government Warning text wrong / missing | `fail` | `non_compliant` | Rejected tab |
| Government Warning correct but styling uncertain | `uncertain` | no change | as-is |
| Any other rule warning | `warn` | `needs_review` | Approved tab |
| Application/label comparison may differ | informational | `needs_review` | Approved tab |
| All rules pass and comparisons are clean | `pass` | `compliant` | Approved tab |

The UI intentionally phrases comparison findings as "may differ" because OCR,
PDF text extraction, and label layout can all be imperfect. The reviewer gets
the source view and final say.

---

## Architecture

```
POST /api/verify  (multipart, one `pdf` field)
  → pdf/render.ts             renderApplicationPages(buffer)
                              keeps full PDF pages for display and creates
                              OCR-only label-artwork masks for extraction
  → pdf/parse-form.ts         parseApplicationFormFromRenderedPages(...)
                              reads needed Form 5100.31 fields from PDF text
                              and emits PDF-source bboxes
  → extraction/factory.ts     default LABEL_EXTRACTOR=tesseract
  → extraction/tesseract-extractor.ts
                              Tesseract OCR on label artwork + selective
                              OpenAI VLM fallback for hard fields
  → application/loader.ts     synthesizeExpectations(form)
  → validation/engine.ts      runVerification(application, label)
                              ├── cross-check/engine.ts   needed app/label checks
                              └── validation/rules/...    TTB label rules
  → results/result-types.ts   ResultLine — NDJSON wire shape
  → db/persist-verification.ts
                              persists PDF bytes, extracted data, report,
                              queue status, and bbox sidecars
  → queue-page.tsx            Queue / Approved / Rejected / Finalized tabs

GET /applications/[id]        detail view: rules + finalized/review history + PDF
POST /api/finalize            appends a review row and sets approved/rejected
POST /api/archive             sets archived_at for finalized rows
GET /api/applications/[id]/pdf serves the persisted source PDF
```

### Key Decisions

- **PDF text first for the form.** The app reads a small set of known Form
  5100.31 fields from the PDF text layer before OCR. This is faster and more
  reliable than asking a vision model to reread the whole form.
- **OCR only label artwork.** Rendered pages stay intact for review, but OCR
  images are masked to the embedded label regions so form text such as
  `Image Type: Back` cannot become a label field.
- **Side-agnostic label extraction.** The verifier looks for required fields
  wherever label artwork appears. A page is tagged as back only when the PDF
  actually marks a following label as `Image Type: Back`.
- **Word-level bboxes.** PDF text and Tesseract values carry word rectangles in
  rendered-page pixel coordinates. VLM fallback values carry no fake bbox.
- **One-at-a-time uploads.** Batch upload is supported in the UI, but each PDF
  is verified sequentially. Field-level OpenAI fallback calls are throttled and
  retried separately.
- **Finalized is not archived.** Approved/rejected rows stay editable in the
  Finalized tab until the reviewer explicitly archives them.

### Stack

- **Next.js 15.5** App Router, React 19, Tailwind 4.
- **pdfjs-dist 4.x** + `@napi-rs/canvas` for server-side PDF rendering.
- **Tesseract.js 7** for OCR and native word-level bboxes.
- **OpenAI SDK** for optional VLM fallback and the legacy full-document
  extractor path.
- **Drizzle + Neon Postgres** for application, review, PDF, and archive state.
- **Zod 3** for environment, extraction, validation, and NDJSON contracts.
- **Langfuse** for tracing when keys are configured; no-op otherwise.
- **Vitest** for deterministic tests. No live OpenAI calls in CI.

### File Map

```
src/lib/
  pdf/render.ts              PDF render, page classification, label masks
  pdf/parse-form.ts          Form 5100.31 text-layer parser + PDF bboxes
  extraction/types.ts        ExtractedDocument, FieldBbox, provider contracts
  extraction/tesseract-extractor.ts
                              OCR-first extraction + VLM fallback orchestration
  extraction/openai-extractor.ts
                              legacy full-document extractor + single-field fallback
  extraction/openai-throttle.ts
                              provider concurrency + retry guard
  application/loader.ts      synthesize form expectations for comparison
  cross-check/engine.ts      application/label comparison helpers
  validation/engine.ts       verdict tiers + rule orchestration
  validation/rules/...       TTB label rule modules
  wine/                      grape varietal and appellation lexicon helpers
  detail-view/select-field.ts
                              click target selection for bboxes/no-source states

src/db/
  schema.ts                  applications + reviews lifecycle
  applications.ts            queue, finalized, archive listing helpers
  persist-verification.ts    insert verified PDF/report rows

src/components/
  queue-page.tsx             upload queue and four review tabs
  detail-report-view.tsx     detail page layout
  report-sections.tsx        compact TTB label rules panel
  source-viewer.tsx          PDF page viewer + bbox overlays
  finalize-form.tsx          approve/reject/revise form

src/app/
  (app)/page.tsx             server entry for queue data
  (app)/applications/page.tsx          archived list only
  (app)/applications/[id]/page.tsx     detail view
  api/verify/route.ts        render → parse → extract → verify → stream + persist
  api/finalize/route.ts      human decision; locked only after archive
  api/archive/route.ts       archive finalized rows
```

---

## Environment

Default local/deploy path:

```bash
LABEL_EXTRACTOR=tesseract
OPENAI_API_KEY=sk-...          # optional but recommended for fallback
OPENAI_VLM_MODEL=              # optional override, e.g. gpt-5.4-mini
DATABASE_URL=                  # optional locally; required for queue persistence
```

`LABEL_EXTRACTOR=openai` and `LABEL_EXTRACTOR=azure-openai` are retained for
legacy comparison/testing, not for the default deployed flow.

`EXTRACT_PROVENANCE` only affects the legacy full-document OpenAI extractor.
The Tesseract path always uses `bboxes` for source highlighting.

---

## Testing

Run before merging:

```bash
npm run typecheck
npm run lint
npm test
```

The tests cover PDF rendering/classification, form parsing, OCR extraction
helpers, wine lexicon matching, cross-check normalization, validation rules,
result schemas, and API route behavior with mocked extraction.

---

## Deployment

Vercel deploys from `main`.

- Required production env for persistence: `DATABASE_URL`.
- Recommended production env for extraction quality: `OPENAI_API_KEY`.
- Optional: `OPENAI_VLM_MODEL`, `OPENAI_MAX_CONCURRENT_REQUESTS`,
  `OPENAI_MAX_RETRIES`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_HOST`.
- Run `npm run db:push` against the production Neon branch after schema
  changes.

`next.config.mjs` keeps `@napi-rs/canvas` and `pdfjs-dist` external and
force-includes the pdfjs worker and standard fonts so server rendering works
inside Vercel.

---

## What this prototype isn't

- **Not a COLAs system integration.** It is a standalone verifier.
- **No reviewer accounts or roles.** The Finalize form stores optional
  reviewer initials only.
- **No production security hardening.** There is no public-demo rate limiting
  beyond the app's sequential verify queue and provider fallback throttling.
- **PDF storage uses Postgres `bytea`.** Fine for the prototype; move to object
  storage for larger deployments.

---

## Historical Notes

Dated files under `docs/brainstorms/` and `docs/plans/` are retained as design
history. They may describe earlier GPT-4o-only, two-file, async patch, or
side-by-side UI ideas. Treat this README and the code on the current branch as
the source of truth for the deployable architecture.

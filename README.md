# TTB Label Verification

Prototype for the U.S. Department of the Treasury / Alcohol and Tobacco Tax and Trade Bureau. A TTB reviewer drops one or more **COLA application PDFs** (TTB Form 5100.31 with the affixed label artwork) into a queue. The system reads the form and the label in one GPT-4o vision call, runs the six TTB label-only rules, surfaces any drift between the application and the label, and routes each row into a reviewer lifecycle: **Queue → Approved / Rejected → Finalized → Archive**.

Production-shaped, not production-ready.

---

## What it does

1. Reviewer picks one or more PDFs from the demo dropdown (20 real TTB COLA Online exports under `public/samples/cola/`) or drops their own COLA PDFs onto the queue.
2. For each PDF the server renders the form page plus every label page (real exports put labels on page 2+) to 200 DPI PNGs via `pdfjs-dist` + `@napi-rs/canvas`.
3. One GPT-4o (`gpt-4o-2024-11-20`) vision call returns:
   - the **application form** fields walked over TTB Form 5100.31 items 1–18
   - the **label** fields (brand, ABV, government warning verbatim, net contents, class, producer, country, wine fields)
4. Server synthesizes the canonical `Application` from the extracted form, then runs:
   - **Six TTB label-only rules** (brand, ABV format, government warning verbatim, net contents, fanciful name, producer & origin) — these drive the verdict.
   - **Cross-check** (informational) — per-field drift between the application and the label.
5. **Three-tier verdict:**
   - `non_compliant` — Government Warning rule **failed**. Auto-routes to the Rejected tab.
   - `needs_review` — any non-GW rule warned (format quirks, missing brand, country phrasing) OR the cross-check surfaced drift. Routes to Approved with "AI suggests Approve" — the reviewer is the decider.
   - `compliant` — every rule passed and cross-check is clean.
6. Reviewer flips or keeps the AI's decision in the Finalize panel; the row moves to the **Finalized** tab. From there a multi-select "Archive Selected" button moves rows to `/applications` (the archive).
7. Result streams back as NDJSON. The detail view (`/applications/[id]`) shows TTB Label Rules → Side-by-side (application vs label) → Application form fields, with the PDF on the left.

---

## Quick start

Requirements: Node 20+ (developed against Node 26), npm.

```bash
git clone <repo-url>
cd ttb-label-verify
npm install
cp .env.example .env.local
# Edit .env.local: OPENAI_API_KEY (DATABASE_URL is optional but enables Queue persistence)
npm run dev
```

Open <http://localhost:3000>. No login — the demo password gate was removed; the homepage is the queue.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server with HMR |
| `npm run build` | Production build (runs `next lint` as a hard gate) |
| `npm start` | Production server |
| `npm test` | Vitest — 293 tests across pdf render, extraction, cross-check, validation, results, exports, route |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `next lint` |
| `npm run eval` | Legacy 5-case label-image eval (needs `OPENAI_API_KEY`; predates the PDF pivot — see `evals/README.md`) |
| `npm run db:push` | Apply Drizzle migrations to Neon Postgres |
| `npm run db:reset -- --yes` | Drop + recreate every table |

### Demo flow

The homepage opens on the **Queue** tab with four tabs across the top:

| Tab | What's in it |
|---|---|
| **Queue** | In-flight uploads. Rows leave automatically as the AI verdict comes back. |
| **Approved** | Verdict `compliant` or `needs_review`. AI default action = Approve. Awaiting reviewer Finalize. |
| **Rejected** | Verdict `non_compliant` (GW failure). AI default action = Reject. Awaiting reviewer Finalize. |
| **Finalized** | Reviewer finalized — multi-select + "Archive Selected" moves rows to `/applications`. |

Pick one or many PDFs from the scenario dropdown (multi-select; "Run N selected") or drop your own PDFs onto the queue. Click any verified row to open the detail view at `/applications/[id]`.

---

## Verdict model

Only the Government Warning auto-rejects. Everything else is reviewer judgment.

| Rule outcome | Status | Verdict contribution | Where it lands |
|---|---|---|---|
| Government Warning text wrong / missing | `fail` | `non_compliant` | Rejected tab, AI suggests Reject |
| Government Warning correct but visual styling (bold/all-caps) uncertain | `uncertain` | no change | as-is |
| Any other rule (net contents format, ABV format, missing brand, etc.) | `warn` | `needs_review` | Approved tab, AI suggests Approve |
| Cross-check mismatch (drift between application + label) | informational | `needs_review` | Approved tab |
| All rules pass + cross-check clean | `pass` | `compliant` | Approved tab |

Why this shape: stakeholder framing places the Government Warning under 27 CFR §16.21 as the one word-for-word rule. Everything else (brand drift, importer-vs-producer, ABV phrasing) is the kind of judgment call a TTB reviewer applies in practice — surfacing it as "look here" beats auto-rejecting on a brittle regex.

UI consequence: the rules panel uses red `X` only for the GW failure, amber `⚠` for warnings and cross-check drift, green `✓` for pass.

---

## Architecture

```
POST /api/verify  (multipart, one or more `pdf` fields)
  → pdf/render.ts             renderApplicationPages(buffer) → [{pageNumber, kind, png}]
                              classifies pages: form (text markers), label (image XObject + low text)
  → extraction/openai-extractor.ts
                              extract(pngs) → ExtractedDocument
                              ({ application, label, provenance? })
  → application/loader.ts     synthesizeExpectations(form) → Application
  → validation/engine.ts      runVerification(application, label) → VerificationReport
                              ├── cross-check/engine.ts   runCrossCheck(...)   [informational]
                              └── validation/rules/...    six TTB rules        [verdict-driving]
  → results/result-types.ts   ResultLine — NDJSON wire shape
  → db/applications.ts        persistVerification → applications row, status pending_*
  → queue-page.tsx            tabs + finalize + archive

GET /applications/[id]        detail view: TTB rules → side-by-side → form fields, PDF on the left
POST /api/finalize            sets terminal status (approved | rejected) + reviewer attribution
POST /api/archive             multi-row: sets archived_at, moves to /applications archive
GET /api/applications/[id]/pdf  serves the persisted source PDF as bytea
```

### Key decisions

- **One vision call.** Form + label live on the same page (or adjacent pages); splitting doubles latency without accuracy gain.
- **Multi-page render.** Real TTB COLA exports put the form on page 1, front label on page 2, back label on page 3. Selection picks the highest-marker form page + every page with a label marker + every text-light page with embedded image XObjects (catches back labels). Capped at 4 pages.
- **3-tier severity.** Only GW failure → `non_compliant`. Every other rule failure is a `warn` that routes to `needs_review` → Approved bucket. The reviewer can still flip.
- **Cross-check is informational, not a Rule.** Rules consume only `ExtractedFields`; cross-check needs both `Application` and `ExtractedFields`. Sibling module + amber icons keep cross-check from driving the verdict.
- **Cross-check granularity is per-field, with intentional fuzziness inside comparators.** Corporate-suffix strip, token-set producer match, "IMPORTED" as wildcard for any non-USA country, case-insensitive GW canonical compare.
- **Deterministic extractor settings.** `temperature: 0`, `seed: 1`. `EXTRACT_PROVENANCE` defaults `false` (no bbox map) for ~4× speedup; flip to `true` to enable click-to-highlight on the detail view.
- **PROMPT_VERSION bumped on every substantive prompt change** (`2026-06-11.v7`, `2026-06-11.v7-nobbox`) so Langfuse traces don't conflate revisions.

### Stack

- **Next.js 15.5** App Router, React 19. Tailwind 4 + shadcn-style components, `next-themes` for the toggle.
- **OpenAI** `gpt-4o-2024-11-20` via the `openai` SDK with structured output (Zod → JSON Schema).
- **pdfjs-dist 4.x** + `@napi-rs/canvas` for server-side page rendering.
- **react-pdf 9.x** for the client viewer (dynamic import).
- **Drizzle + Neon Postgres** for application + review + archive persistence. Migrations in `drizzle/0000-0003`.
- **Zod 3** for every wire boundary.
- **Langfuse** for prompt/trace observability when keys are set; no-op otherwise.
- **Vitest** for unit + integration tests. No live LLM in CI.

### File map

```
src/lib/
  pdf/render.ts              multi-page PNG render + page classification
  extraction/types.ts        ExtractedDocument, ExtractedApplicationForm, ExtractedFields
  extraction/prompt.ts       dual-extraction prompt (PROMPT_VERSION 2026-06-11.v7)
  extraction/openai-extractor.ts
  extraction/factory.ts      DI for provider swap (openai / azure-openai)
  application/types.ts       Application Zod schema
  application/loader.ts      parseApplication + synthesizeExpectations
  cross-check/engine.ts      runCrossCheck (informational)
  cross-check/normalize.ts   token-set, corporate-suffix strip, class-type aliases
  validation/engine.ts       runVerification (cross-check ∘ rules, 3-tier verdict)
  validation/rules/...       six TTB rule modules (only GW emits 'fail')
  validation/types.ts        FieldStatus = 'pass' | 'warn' | 'fail' | 'uncertain'
  results/result-types.ts    ResultLineSchema (Zod wire contract)
  observability/             Langfuse client + span helpers

src/db/
  schema.ts                  applications + reviews; aiVerdictToInitialStatus
  applications.ts            listFinalizedNotArchived, archiveApplications, countByQueueBucket
  client.ts                  Drizzle + Neon HTTP

src/components/
  queue-page.tsx             Queue / Approved / Rejected / Finalized tabs
  detail-report-view.tsx     section ordering for /applications/[id]
  report-sections.tsx        TTB rules + Side-by-side + Application form panels
  finalize-form.tsx          AI verdict pill + Approve/Reject + reason + finalize
  pdf-viewer.tsx             react-pdf + bbox overlay (dynamic-imported)
  scenario-picker.tsx        multi-select demo dropdown
  site-header.tsx            top nav: TTB Label Verification · Archive

src/app/
  (app)/page.tsx             server entry — fetches queue + finalized + counts
  (app)/applications/page.tsx          archived list
  (app)/applications/[id]/page.tsx     detail view
  api/verify/route.ts        POST: render → extract → synthesize → verify → stream + persist
  api/finalize/route.ts      POST: terminal decision + reviewer attribution
  api/archive/route.ts       POST {applicationIds[]}: sets archived_at
  api/applications/[id]/pdf  GET: serves persisted PDF bytea

public/samples/
  cola/                      20 real TTB COLA exports (the demo picker uses these)
  applications/              5 legacy synthetic fixtures (kept only for route.test.ts)
  Blank-COLA-Form-1513.pdf   the empty form
```

---

## Cost

A single verify call against a real multi-page COLA export runs ~**$0.02–$0.05** on `gpt-4o-2024-11-20` and ~**8–15s** end-to-end (the vision call dominates). `PROMPT_VERSION` + per-trace cost surface in Langfuse when keys are set.

`EXTRACT_PROVENANCE=false` (the default) drops the bounding-box map from the model's output and is ~4× faster than the bbox-on path. Flip to `true` if you want click-to-highlight provenance on the detail view.

---

## Testing

`npm test` runs 293 tests against a clean tree:

- `src/lib/pdf/render.test.ts` — renders a real scenario PDF, asserts PNG magic bytes, deterministic dimensions, multi-page classification.
- `src/lib/extraction/` — schemas, prompt version pin.
- `src/lib/application/loader.test.ts` — `parseApplication` + `synthesizeExpectations`.
- `src/lib/cross-check/` — engine + normalize.
- `src/lib/validation/` — rules + engine 3-tier severity (only GW fails to `non_compliant`; everything else routes to `needs_review`).
- `src/lib/results/` — Zod round-trip, NDJSON stream consumer.
- `src/app/api/verify/route.test.ts` — happy path + error cases through the in-process route with a mocked extractor.
- `src/app/api/verify/route.scenarios.test.ts` — 5-scenario truth table (synthetic fixtures only).

No live LLM calls in CI. `npm run eval` is the legacy label-image suite under `evals/` and predates the PDF pivot — see `evals/README.md`.

---

## Deployment

Auto-deploys to Vercel on push to `main`.

- **Env vars (Vercel project):** `OPENAI_API_KEY`, `DATABASE_URL` (Neon connection string). Optional: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`.
- **Migrations to prod:** `npm run db:push` against the Neon production branch after schema changes.
- **`next.config.mjs`:**
  - `serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist']` keeps the native binary + pdfjs worker out of the webpack bundle.
  - `transpilePackages: ['react-pdf']` so the client viewer initializes cleanly.
  - `outputFileTracingIncludes['/api/verify']` force-includes `pdfjs-dist/legacy/build/{pdf.worker.mjs,pdf.mjs}` and `pdfjs-dist/standard_fonts/**`. The render module computes those paths via `process.cwd() + path.join(...)` to defeat webpack's static analyzer — that same dodge blinds Vercel's file tracer, so they have to be force-included.

---

## What this prototype isn't

- **Not a COLAs system integration.** Standalone verifier; the COLAs system is out of scope.
- **No multi-label model awareness.** The COLA form allows multiple physical labels (front + back + neck); the prototype reads the full set as a single "label" surface and isn't asked to split.
- **No reviewer accounts, no roles, no anti-abuse.** The Finalize panel takes an optional initials field for the audit trail.
- **No production hardening.** No rate limiting, no privilege separation, no public-demo throttling.
- **PDF storage scales with the Neon free tier.** PDFs are persisted as `bytea`; Neon free is 0.5 GB. Migrate to Vercel Blob if you need more headroom.

---

## Project history

Pivots that shaped the current architecture:

- `docs/plans/2026-06-09-001-feat-ttb-label-verify-plan.md` — initial label-only verifier.
- `docs/plans/2026-06-10-001-feat-cross-check-plan.md` — pivot to application + label cross-check.
- `docs/plans/2026-06-10-002-feat-pdf-verifier-plan.md` — pivot to single-PDF input + bounding-box provenance + the Queue/Finalize/Archive lifecycle.

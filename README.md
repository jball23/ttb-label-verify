# TTB Label Verification

Prototype for the U.S. Department of the Treasury / Alcohol and Tobacco Tax and Trade Bureau. Reviewers upload alcohol beverage label images; the app extracts the TTB-regulated fields with AI vision and validates them against compliance rules in under ~5 seconds per label.

Built in a 24-hour take-home window. The code is production-shaped — not production-ready.

---

## Live demo

> **The deployed URL and demo password are provided separately to the reviewers.**

The demo is gated by a shared password (no real accounts). On first visit you'll be sent to `/login`. After authenticating, drop one or more label images and click **Verify**.

The included **Try a sample label** link works once a sample image is placed at `public/samples/compliant-bourbon.jpg` (see [Sample labels](#sample-labels)).

---

## Quick start (local development)

Requirements: Node 20+ (this was developed against Node 26), npm.

```bash
git clone <repo-url>
cd ttb-label-verify
npm install
cp .env.example .env.local
# Edit .env.local: OPENAI_API_KEY, DEMO_PASSWORD, DEMO_PASSWORD_COOKIE_SECRET (32+ chars)
npm run dev
```

Open <http://localhost:3000>.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server with HMR |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm test` | Vitest, runs 189 tests across validation, extraction, streaming, results, exports |
| `npm run typecheck` | `tsc --noEmit` — strict mode, no `any` |
| `npm run lint` | `next lint` |
| `npm run eval` | LLM eval suite (requires sample images — see [Evals](#evals)) |

---

## What it does

1. Drop one or more alcohol-label images (PNG / JPG / WebP / PDF, ≤10 MB each, ≤25 per batch).
2. Each image is sent to GPT-4o Vision with a structured-output schema; the model returns extracted fields as JSON.
3. A deterministic rule engine runs six TTB checks on the extraction:
   - **Brand name** — present
   - **Alcohol by volume (ABV)** — present and in a recognized format
   - **Government Warning** — exact-text match against the canonical 27 CFR §16.21 text
   - **Net contents** — present with a recognized unit (mL, L, fl oz)
   - **Class/type designation** — present
   - **Producer + country of origin** — both present
4. Per-label results stream back as NDJSON; the UI renders each card as soon as its result arrives.
5. Download JSON or CSV of the full batch.

---

## Architecture decisions

### Why OpenAI, not Anthropic
Treasury procurement may not have Anthropic on the approved list. OpenAI is broadly federally accepted, and — critical — Azure OpenAI is FedRAMP High authorized and uses the same `openai` SDK with a different `baseURL` and `api-key` header. The migration is one env var, not a port. (Anthropic is also a great choice technically; this is a procurement reality decision.)

### Why USWDS, not Tailwind or shadcn/ui
The U.S. Web Design System is the federal design standard, ships Section 508 / WCAG 2.1 AA compliance out of the box, and includes the official USA banner. Building this in Tailwind would look like a generic SaaS app; USWDS looks like a TTB tool. We dropped Tailwind entirely because USWDS preflight conflicts.

### Why NDJSON streaming, not SSE or React Server Components
The verify route returns `text/x-ndjson` — one JSON line per completed label. The client reads with `fetch().body.getReader()` and an Zod-validated stream consumer. Simpler than SSE (no `EventSource` reconnection logic), more compatible with Vercel function timeouts than RSC streaming, and keeps the result-card lifecycle in plain React state.

### Why light mode only
USWDS is light-mode-first. Native dark mode isn't an official feature. We chose authenticity over dark-mode coverage — federal sites look like federal sites.

### Why a stub Azure implementation, not a real one
The narrative is that Azure OpenAI is the production path. Implementing both wouldn't have changed the demo, only delayed it. The stub throws `NotImplementedError` (Liskov-safe — no silent mock data) and carries the constructor signature, so the swap is obvious. With another day, this becomes 20 lines of `new OpenAI({ baseURL, apiKey, defaultHeaders: { 'api-key': key } })`.

### Why Langfuse, not LangSmith
Same logic as the AI provider — Langfuse is OSS and self-hostable (Docker Compose, runs on Azure Container Apps). LangSmith has slightly nicer polish but no community self-host. Adding LangSmith would have introduced a second SaaS dependency the firewall blocks, with no swap path. The Langfuse client no-ops when env vars are absent so the demo never breaks if observability isn't configured.

---

## The firewall constraint and the Azure OpenAI migration path

The brief flags that government firewalls blocked the previous vendor's scanner during pilot. We chose to ship the prototype on OpenAI's public API for the 24-hour budget, with two structural commitments that make the production swap one env var:

**1. The `LabelExtractor` interface.** All calling code (route handler, eval runner) depends on `LabelExtractor`, not on `OpenAIExtractor`. The factory at `src/lib/extraction/factory.ts` reads `LABEL_EXTRACTOR` and returns the right implementation.

**2. The Azure implementation stub.** `src/lib/extraction/azure-openai-extractor.ts` is a documented stub. In production, it constructs an OpenAI client with `baseURL` pointed at an Azure OpenAI deployment and `api-key` in the headers. Same `chat.completions.create` call, same `zodResponseFormat` for structured outputs, same Zod parse — all reusable verbatim.

**Production deploy would be:**
1. Provision an Azure OpenAI resource with a `gpt-4o` (or equivalent vision) deployment inside the FedRAMP boundary
2. Implement `AzureOpenAIExtractor.extract` (mostly copy from `OpenAIExtractor`, change the client construction)
3. Set `LABEL_EXTRACTOR=azure-openai`, `AZURE_OPENAI_ENDPOINT=…`, `AZURE_OPENAI_API_KEY=…`
4. Deploy to Azure App Service / Container Apps inside the same boundary
5. (Optional) Self-host Langfuse on Azure Container Apps; set `LANGFUSE_HOST` to the internal URL

The prompt, the schema, the rule engine, the validation logic, the UI, the export formatters — none of that changes.

---

## Code quality

- **TypeScript strict mode.** `noImplicitAny`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
- **No `any`** anywhere. ESLint config enforces `@typescript-eslint/no-explicit-any: error`.
- **Zod schemas at every boundary** — env vars, LLM response, NDJSON result lines, validate before trusting.
- **189 tests** across deterministic logic. Coverage is intentional, not blanket:
  - Validation rules + engine: 81 tests
  - Extraction layer: 8 tests
  - Observability: 7 tests
  - Eval evaluators: 14 tests
  - Streaming, parsing, aggregation, diff: 23 tests
  - File validation, phase reducer, formatters: 27 tests
  - Verify route: 5 tests
  - Env: 9 tests + 30 TTB constant tests = 39 foundation tests
- **SOLID applied:**
  - **SRP** — each rule, each evaluator, each formatter is one file with one job
  - **OCP** — rules are an array of `Rule` objects; adding a rule = adding a file
  - **LSP** — `AzureOpenAIExtractor` throws `NotImplementedError` instead of silent mocks
  - **ISP** — `LabelExtractor`, `Rule`, evaluators are tiny single-purpose interfaces
  - **DIP** — the route handler depends on `LabelExtractor`, never on `OpenAIExtractor`. The factory is the wiring point.

---

## Accessibility

Built on USWDS, which carries WCAG 2.1 AA / Section 508 compliance for its primitives. App-level commitments:

- **Semantic HTML** — `<main>`, `<form>`, `<button>`, semantic headings throughout
- **Official USA banner** at the top of every page (`<GovBanner>`)
- **Skip-to-content link** as the first focusable element
- **Keyboard-parity drag-drop** — USWDS `<FileInput>` handles the keyboard path; we layer drag-and-drop on the same handler so neither path is privileged
- **ARIA live region** announces batch progress (`X of Y labels checked.`) without flooding screen readers
- **Color is paired with text** everywhere status is communicated — verdict tags, status icons, alerts
- **Focus-trap on modals** (USWDS Modal uses `focus-trap-react`)
- **`prefers-reduced-motion`** disables card fade-in
- **Error messages associated** to form inputs via `aria-describedby` + `<ErrorMessage>`
- **Contrast** uses USWDS default tokens (4.5:1+ for text)

**Verification before submission:**
- Run axe-DevTools on every state (empty, staged, processing, done, login, login-error). Fix every violation.
- Run Lighthouse Accessibility audit on `/` (empty state). Target ≥95.
- Complete the keyboard-only flow: login → upload → verify → expand a failed warning → download → start over.
- VoiceOver spot-check on a completed result card.

These steps need a deployed (or `npm run start`) instance; they're the closing checklist for the reviewer.

---

## Evals

We treat the LLM as a versioned dependency we measure, not a magic box. `npm run eval` runs the suite, posts traces to Langfuse (if configured), and exits non-zero when extraction quality drops below thresholds.

See [`evals/README.md`](./evals/README.md) for the dataset, evaluators, CI thresholds, and how to add a case.

**Two scorers** (both pure functions, fully tested):
- **`field-extraction-accuracy`** — per-field precision with hallucination + miss detection (`expected null` → `actual value` = score 0)
- **`government-warning-match`** — binary exact-match after whitespace normalization

**Thresholds:**
- Aggregate field-accuracy ≥ 0.85 → required
- Warning-match pass rate ≥ 1.0 → required (warning is the high-stakes field)

Each eval run also posts a trace to Langfuse with the case ID, image SHA, full prompt + response, latency, tokens, and scores. Production debugging starts at the Langfuse trace.

---

## Observability

Every label extraction is wrapped in `observeOpenAI()`, producing a trace per request with one child span per label. Traces include:

- Filename, MIME type, byte size, SHA-256 of the image (correlation key, not the bytes)
- Prompt version (`PROMPT_VERSION` in `src/lib/extraction/prompt.ts`)
- Model name, token usage, latency
- Zod parse outcome
- Rule engine verdict counts as span metadata
- Per-label errors (if any)

**Privacy:** image bytes are never sent to Langfuse, only their SHA. The image is processed in memory and discarded.

**Failure mode:** if `LANGFUSE_PUBLIC_KEY` is absent, the entire observability layer is a no-op. The demo works identically. If Langfuse is configured but errors, span helpers silently swallow — a tracing outage never affects user-visible behavior.

---

## Trade-offs and honest limitations

**Visual styling judgment is fuzzy.** Vision LLMs are weak at typography. The Government Warning rule surfaces "appears bold" and "appears all caps" as model-judgment fields. When the warning text is correct but the model flags styling concerns, we return `uncertain` (not `fail`) and explain why in the UI. We don't claim to enforce the bold/caps requirement deterministically.

**Batch size is 25, not 200–300.** The stakeholder interviews mention batches of 200–300. That's not realistic on Vercel's serverless functions in 5s/label. Production would need a queue worker (Azure Functions + Service Bus, or Azure Container Apps with background jobs). The architecture supports that — the route handler is a thin wrapper around the same `LabelExtractor` + `runRules` calls the queue worker would make.

**No persistent audit trail.** By design (no-PII constraint in the brief), but it means no historical record. Production would persist a redacted log (hash + extracted fields + verdict, never the image).

**No human-in-the-loop override.** The real TTB workflow involves a reviewer accepting or overriding the AI verdict. The prototype shows the AI verdict only. Adding HITL is one component + one persistence layer.

**No CI for the eval suite in this repo yet.** The runner exits non-zero on regression; wiring it into GitHub Actions is straightforward but wasn't in the 24-hour budget.

**Test coverage is scoped.** The deterministic logic (validation rules, formatters, parsers, reducer, diff, evaluators) is heavily tested. UI components are not unit-tested — the testable logic has been extracted out of them into pure modules. The remaining USWDS-composition layer is verified manually via the a11y audit. If a regression surfaces there, the fix is to extract more logic, not bolt on render-tree assertions.

**Sample label images are not committed.** See [Sample labels](#sample-labels).

---

## Sample labels

Two locations need real label images before the demo is fully functional:

- `public/samples/compliant-bourbon.jpg` — the "Try a sample" link target
- `evals/dataset/images/*.jpg` — the five eval cases

We did not commit images because:
1. Bottling distillery photographs typically aren't public domain
2. The eval cases require specific deliberate-defect variants (missing warning, wrong ABV format) that don't exist as off-the-shelf assets

Options for the reviewer / deploying engineer:
- Use Wikimedia Commons public-domain product photography (filter by license, crop to front label)
- Generate with GPT-4o / Imagen / Gemini image generation (label-mockup prompts work well; the deliberate-defect cases need explicit "omit the Government Warning" instructions)
- Use real labels you have on hand

See `evals/dataset/images/README.md` for the file list and naming.

---

## Deploying to Vercel

```bash
# 1. Push to GitHub
git remote add origin <your-repo-url>
git push -u origin main

# 2. From the Vercel dashboard: New Project → Import from GitHub
# 3. Set these environment variables in Vercel:
#    OPENAI_API_KEY=sk-...
#    DEMO_PASSWORD=<reviewer-share>
#    DEMO_PASSWORD_COOKIE_SECRET=<32+ char random>  (openssl rand -base64 32)
#    LABEL_EXTRACTOR=openai
#    (Optional) LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST
# 4. Deploy. First build ~2 minutes.
```

Generate `DEMO_PASSWORD_COOKIE_SECRET` locally with:

```bash
openssl rand -base64 32
```

---

## What we'd do with another week

- Implement the real `AzureOpenAIExtractor` and provision an Azure OpenAI deployment for end-to-end production proof
- Expand the eval corpus to 30–50 labels covering more wine + beer + spirits categories
- LLM-as-judge for the visual-styling fields (bold detection benchmarked against ground-truth annotations)
- Human-in-the-loop review UI: reviewer accepts/overrides each AI verdict, override is the canonical record
- Queue worker (Azure Functions) for 200–300-label batches with progress webhooks
- Annotation overlays on the original label image (highlight the warning, highlight the ABV)
- CI integration: `npm run eval` on every PR, fail the build on regression, post Langfuse trace links to the PR
- Confidence-tuned thresholds per field (raise the bar on the warning, accept more uncertainty on the brand name)
- Expanded TTB rule set: TTB class-catalog validation, prohibited terms, BAM (Beverage Alcohol Manual) lookups

---

## Plan + brainstorm artifacts

The full thinking that led to this codebase is committed to the repo:

- [`docs/brainstorms/2026-06-09-ttb-label-verify-requirements.md`](./docs/brainstorms/2026-06-09-ttb-label-verify-requirements.md) — requirements document
- [`docs/plans/2026-06-09-001-feat-ttb-label-verify-plan.md`](./docs/plans/2026-06-09-001-feat-ttb-label-verify-plan.md) — implementation plan with U-IDs that map directly to commits

The commit history follows the plan unit-by-unit (U1 through U8). `git log --oneline` is the implementation timeline.

---

## Tech stack

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Next.js (App Router) | 15.5 |
| Language | TypeScript strict | 5.6 |
| UI library | @trussworks/react-uswds | 11.0 |
| Design system | U.S. Web Design System | 3.13 |
| AI vision | OpenAI GPT-4o | `gpt-4o-2024-11-20` via `openai` SDK 6.42 |
| Observability + evals | Langfuse | 3.38 |
| Validation | Zod | 3.25 |
| Auth | jose (JWT cookies) | 5.9 |
| Concurrency | p-limit | 6.1 |
| Tests | Vitest | 2.1 |
| Styles | Sass | 1.81 |
| Deploy | Vercel | n/a |

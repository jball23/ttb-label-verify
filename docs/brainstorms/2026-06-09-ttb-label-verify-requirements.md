# TTB Label Verification — Requirements

**Date:** 2026-06-09
**Status:** Approved for planning
**Deadline:** Demo + repo due 2026-06-10
**Source brief:** github.com/treasurytakehome-rgb/instructions

## Problem

TTB (Alcohol and Tobacco Tax and Trade Bureau) reviewers manually check alcohol beverage labels for compliance with federal label requirements. The brief asks for a standalone prototype that uses AI to extract the regulated fields from a label image and validate them against TTB rules. The previous vendor's scanner took 30–40s per label and was blocked by government network firewalls during pilot.

This is a take-home project. The evaluation rewards (1) shipping a usable demo, (2) correctly handling the firewall / sovereignty constraint in the *narrative* even if the prototype itself uses cloud, (3) honest documentation of trade-offs.

## Users

- **Primary:** TTB compliance reviewers — non-technical, "73-year-old grandma" usability bar, half the team is 50+
- **Secondary:** TTB engineering evaluators reading the repo

## Core outcome

A reviewer drops in one or more label images, gets a per-label pass/fail report under ~5s/label, with field-level extraction and clear reasons for any failures.

## In scope (demo)

1. **Single + batch upload.** Drag-and-drop or click-to-upload. Batch up to 25 labels in the demo (the interviews mention 200–300 as the real workflow; we'll explain why the demo is smaller).
2. **Six verification elements:**
   - Brand name (present, matches user-entered expected value if provided)
   - Alcohol by volume (present, format valid: `X.X% ALC/VOL` or equivalent)
   - **Government warning** (exact text match against the canonical TTB string)
   - Net contents (present, valid unit)
   - Class/type designation (present)
   - Producer information + country of origin (present)
3. **Results UI.** For each label: thumbnail, overall pass/fail, per-field extracted value, per-field status (pass/fail/uncertain), failure reasons in plain language.
4. **Downloadable report.** JSON and CSV of the batch results.
5. **Progressive results.** In a batch, results stream in as each label finishes — users don't wait for the slowest one.
6. **Public deploy.** Vercel URL, gated by a shared password env var.
7. **Provider abstraction.** Vision-LLM calls go through a `LabelExtractor` interface with an Anthropic implementation. Stub the Azure OpenAI implementation so the swap is obvious.

## Out of scope

- COLA system integration
- Persistent storage of labels or PII (process in-memory, return results, drop the image)
- User accounts / SSO / role-based access
- Actual deploy to Azure (documented, not built)
- Image annotation overlays beyond simple field highlights in the results card

## Verification rules (the actual TTB checks)

### Government warning — the high-stakes one
Canonical text (27 CFR §16.21):

> GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.

Three sub-checks:
- **Exact text** — deterministic string comparison after extraction; whitespace-normalized
- **"GOVERNMENT WARNING:" prefix in all caps** — checked on the extracted text directly
- **Visually bold rendering** — the vision LLM is asked for a judgment field (`warningAppearsBold: true/false/unsure`). This is a known weak spot; we document it as a limitation.

### Other fields
- **ABV:** regex for `\d{1,2}(\.\d{1,2})?%\s*(ALC/VOL|ALCOHOL\s+BY\s+VOLUME)` (case-insensitive)
- **Brand name:** presence check; optional fuzzy-match against user-provided expected brand
- **Net contents:** presence + unit in {mL, L, fl oz}
- **Class/type:** presence (e.g. "VODKA", "STRAIGHT BOURBON WHISKEY", "BEER")
- **Producer + country:** presence; "BOTTLED BY" / "PRODUCED BY" / "IMPORTED BY" + country string

## Performance

- **Target:** ≤5s per label on a warm function
- **Batch:** parallel `Promise.all` over labels with concurrency cap (e.g. 8 in flight); user sees results stream in
- **Cold start budget:** Vercel function cold start + Anthropic API round-trip is the dominant cost; we accept first-label latency may push 7–8s

## UX principles (the "73-year-old grandma" bar)

- One screen. Big drop zone. Big "Verify" button.
- No jargon in the results — "Government warning is missing the second sentence" not "warning.body.sentence2 = null"
- Color-blind-safe pass/fail (icon + color, not color alone)
- Errors are actionable: "This image is too blurry to read. Try a higher-resolution scan."
- No login on the public demo (single shared password input only)

## Tech stack

- **Framework:** Next.js 15 (App Router) — single deployable, server actions for the upload handler
- **AI:** OpenAI GPT-4o vision behind a `LabelExtractor` interface. **No Anthropic** — Treasury procurement may not have Anthropic on the approved list, OpenAI is already widely used in federal contexts.
- **UI:** **U.S. Web Design System (USWDS) 3.x** via `@trussworks/react-uswds`. Federal design language, Section 508 / WCAG 2.1 AA compliant out of the box, Public Sans + Source Serif Pro, federal blue accent.
- **Styling:** USWDS utility classes + USWDS SCSS token overrides + CSS Modules for one-off layout. **No Tailwind** — conflicts with USWDS preflight and dilutes the federal design language.
- **Theme:** Light mode only. Federal-authentic, all a11y testing in one theme, no toggle UI.
- **Validation:** Zod schemas for the extracted-fields contract
- **Deploy:** Vercel
- **No database.** All processing in memory.

## Accessibility — non-negotiable

Target: **WCAG 2.1 AA**, axe-core clean, Lighthouse Accessibility ≥ 95.

- USWDS components handle the table stakes — focus rings, ARIA roles, keyboard semantics, contrast — out of the box. Don't override their ARIA without reason.
- Official USA banner (`<GovBanner>`) at the very top of every page
- Semantic HTML first (`<main>`, `<nav>`, `<button>`, `<form>`, `<output>` for results)
- USWDS `<FileInput>` provides the keyboard-accessible upload — we layer drag-and-drop on the same handler so neither path is privileged
- ARIA live region announces batch progress ("3 of 10 labels processed") and per-label results
- Status uses USWDS `<Tag>` and `<Alert>` patterns — icon + text, never color-only
- Color contrast ≥ 4.5:1; USWDS tokens already meet this — don't reach for off-palette colors
- Respect `prefers-reduced-motion` — no entrance animations when set
- Form errors use USWDS `<ErrorMessage>` + `aria-describedby`
- Image previews have descriptive `alt` text ("Label preview, filename: bottle-front.jpg") not empty
- Skip-to-content link at the top of the page (USWDS provides the pattern)

## Code quality — SOLID

The provider abstraction already enforces DIP/ISP. Hold the rest of the codebase to the same bar:

- **SRP:** one reason to change per module. `validation/` holds rules, `extraction/` holds the LLM call, `api/` holds the route handler, `components/` holds presentational React. No mixing.
- **OCP:** validation rules are an array of `Rule` objects each implementing `check(extracted): RuleResult`. Adding a rule = adding a file, never editing existing ones.
- **LSP:** every `LabelExtractor` implementation honors the same contract — same input/output shape, same error semantics. The Azure stub must throw `NotImplementedError`, not silently return mock data.
- **ISP:** small interfaces. `LabelExtractor` extracts, `RuleEngine` validates, `ReportFormatter` formats. No god-interface.
- **DIP:** route handler depends on the `LabelExtractor` interface, never on `OpenAIExtractor` directly. Wire via a factory keyed by env var.

Plus the table stakes that catch quality slippage:
- TypeScript strict mode, no `any`, no `@ts-ignore`
- ESLint + Prettier, zero warnings on commit
- One-screen functions — if it exceeds the screen, it needs a split
- Tests on the validation rules and the report formatter (deterministic logic, fast feedback); skip tests on the LLM-call layer (it's the seam, not the substance)

## Provider abstraction (the firewall story)

```
interface LabelExtractor {
  extract(image: Buffer): Promise<ExtractedFields>
}
```

- `OpenAIExtractor` — used in the demo, calls `api.openai.com`
- `AzureOpenAIExtractor` — same OpenAI SDK with a `baseURL` and `api-key` header pointed at an Azure OpenAI deployment. Stub class implemented; provisioned by env vars only.
- Selected via `LABEL_EXTRACTOR=openai|azure-openai` env var

The README explains: "The prototype calls OpenAI's public GPT-4o endpoint. The same `openai` SDK, the same prompt, and the same Zod schema run unchanged against an Azure OpenAI deployment inside the FedRAMP High boundary — set `LABEL_EXTRACTOR=azure-openai` and provide the Azure endpoint + key. We chose OpenAI over a local model because (a) GPT-4o accuracy on label crops is significantly better than current open-vision models, (b) Azure OpenAI is already FedRAMP High authorized and lives inside the gov boundary that hosts COLA post-2019, (c) the swap is one env var, not a port."

## Success criteria (demo)

- [ ] Public Vercel URL works end-to-end with no setup
- [ ] Single label uploads → result ≤5s warm
- [ ] Batch of 10 labels → all results visible <30s, streaming
- [ ] Catches: missing warning, wrong warning text, missing ABV, missing class
- [ ] Downloadable JSON + CSV report
- [ ] Lighthouse Accessibility ≥ 95, axe-core clean, keyboard-only flow works end-to-end
- [ ] USWDS components used throughout, official USA banner present, no off-system colors or fonts
- [ ] TS strict, ESLint zero warnings, no `any`
- [ ] README covers: how to run, assumptions made, trade-offs, Azure OpenAI migration path, "what we'd do with another week"
- [ ] Repo is public on GitHub with clean commit history

## Risks + honest trade-offs (call out in README)

1. **Cloud LLM ≠ firewall-safe.** We picked accuracy + ship time. Production path documented but not built.
2. **5s on 200–300 labels is unrealistic on serverless.** Demo target is 5s/label parallelized. Production would need a queue worker (Azure Functions, Service Bus).
3. **Bold/all-caps font detection is hard for vision LLMs.** We extract text reliably; we judge visual styling with a confidence flag and document the gap.
4. **No persistent storage** — by design (no-PII constraint), but it means no audit trail in the prototype.
5. **No human-in-the-loop review.** Real TTB workflow involves a reviewer overriding the AI; the demo shows the AI verdict only.

## What we're explicitly NOT doing in 24h

- Building the Azure OpenAI implementation
- Real auth / role-based access
- Annotation overlays on the original image
- Confidence-tuned thresholds (we'll use defaults)
- Test corpus beyond a handful of sample labels
- CI/CD beyond Vercel's git deploy

## Open questions for planning

- Which sample labels do we use for the demo? (Need 5–10 real + a few deliberately broken ones.)
- Does the password gate go in middleware or a homepage form?
- Do we want a "test mode" with mock results for the README screenshots in case the API key gets rate-limited during the demo?

## Handoff

Next: `/ce-plan` to break this into a task DAG, or `/do` to run the full Queen→Scout→Worker pipeline. Recommend `/ce-plan` first so we can sanity-check the breakdown before workers start.

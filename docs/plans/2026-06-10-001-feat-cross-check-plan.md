---
title: "feat: Application + Label Cross-check"
status: active
created: 2026-06-10
plan_type: feat
origin: docs/brainstorms/2026-06-09-ttb-label-verify-requirements.md
deadline: 2026-06-10
---

# feat: Application + Label Cross-check

## Summary

Pivot the verifier from "label rules only" to "application-vs-label cross-check + label rules". The verify endpoint accepts a filled COLA application (JSON) alongside a label image, the extractor pulls regulated fields from the label (now including wine varietal + appellation), a new cross-check engine diffs the application's declared fields against the extracted label fields per-field, and the result card surfaces a new "Cross-check" section above the existing six TTB label-only rules. Overall verdict flips to `NEEDS_REVIEW` on any single field mismatch — independently of whether the label-only rules pass. NDJSON streaming, password gate, OpenAI extractor, and the existing Rule modules stay as-is.

This builds on the demo dataset shipped earlier today under `public/samples/applications/` (5 scenarios, each with `application.json` + `label.jpg` + `application.pdf` + `label-prompt.md`), driven by `scripts/build-demo-pdfs.mjs`. The dataset's `expectedVerdict` and `intentionalMismatches` fields drive the regression eval.

---

## Problem Frame

The current prototype validates a label image in isolation against six TTB rules. In reality, a TTB reviewer looks at the COLA application **and** the submitted labels together — they verify the label matches what the applicant certified on Form 5100.31, then check the label against the rules. Validating labels without the application is a partial workflow. Pivoting to the cross-check model:

1. Matches what TTB reviewers actually do, making the demo narrative truer to the domain.
2. Naturally produces mixed outcomes (clean pass / cross-check fail / label-rule fail / both) — better demo than "every label that has a Government Warning passes".
3. Doubles the discriminating power of the eval — each scenario tests both the cross-check engine and the rule engine.

Locked decisions from the session that produced this plan:

- **API shape (a)**: verify route accepts `application.json` + label image. Parsing the filled PDF back to JSON is brittle and deferred.
- **Per-field strict granularity**: any single mismatch → `NEEDS_REVIEW`.
- **NDJSON streaming preserved**: cross-check is an additional section on the existing report shape, not a separate event type.
- **Application JSON is REQUIRED** at verify time. The demo dropdown loads scenario fixtures so users can demo without uploading their own application.
- **Comparison strategy: normalized exact** for brand / varietal / appellation (trim + casefold + collapse whitespace + strip corporate suffixes like "LLC", "Inc."); **token-set match on company name + city/state** for producer.
- **Wine-only fields skipped for non-wine** — cross-check checks `application.productType === 'WINE'` before applying varietal/appellation comparison.

---

## Scope Boundaries

### In scope (this plan)

- Extend `ExtractedFields` with `wineVarietal` + `wineAppellation`, both nullable, populated by the extractor only when the label class/type reads as wine.
- New `Application` Zod schema mirroring `application.json` (form fields + `crossCheckExpectations` + `labelOnlyExpectations` + `expectedVerdict` + `intentionalMismatches`).
- New `src/lib/cross-check/` module: per-field comparators producing `CrossCheckFieldResult { status: 'match' | 'mismatch' | 'not_on_label' | 'not_applicable', applicationValue, labelValue, reason? }` and a `CrossCheckReport`.
- Aggregated `runVerification(application, extracted)` that composes cross-check + label rules, flipping `overallStatus` to `NEEDS_REVIEW` on any cross-check mismatch OR any rule fail.
- Verify route accepts `application` field (JSON string) in the multipart form alongside label files. Rejects with `400` if missing or invalid against the Application schema.
- `ResultLine` schema extended with the cross-check section; client validates the new shape with Zod.
- Extractor prompt updated to pull varietal + appellation (wine only); `PROMPT_VERSION` bumped.
- Result card gets a "Cross-check (application vs label)" accordion section above the rule rows; per-field rows show both sides with match/mismatch glyph.
- Upload UI gets a "Try a demo scenario" dropdown (5 options) that fetches the scenario's `application.json` + `label.jpg` from `/samples/applications/0N-*/` and populates the upload state.
- New eval evaluator `cross-check-accuracy` iterates `public/samples/applications/`, runs the full pipeline (extractor + cross-check + rules), and asserts the verdict + per-field result list against each scenario's `expectedVerdict` + `intentionalMismatches`.
- Unit tests for cross-check engine, normalize utilities, Application schema, ResultLine schema; integration test running all 5 scenarios through the route handler in-process.

### Deferred for later

- Parsing the filled `application.pdf` back to JSON (would let users drop the PDF directly — currently they pass `application.json`).
- Multi-label cross-check (the COLA form allows multiple affixed labels — front + back + neck). Plan handles single-label-per-application; the dataset is already 1:1.
- "Approved certificate" framing (filling Part III with DATE ISSUED / TTB ID / authorized signature on the filled PDFs). Conversation surfaced this as a framing choice; the cross-check pipeline works either way.
- Per-field reviewer override UI ("mark this mismatch acceptable").
- Persistence of verify results.
- Eval images for the original (label-only) test corpus — those remain in `evals/dataset/` and the legacy evaluators still run, but new evaluators only target the scenario dataset.

### Outside this product's identity

- COLA system integration (still standalone, per origin).
- User accounts / per-reviewer audit trail.
- Application form filling — that lives in `scripts/build-demo-pdfs.mjs` as data prep, not in the runtime.

### Deferred to Follow-Up Work

- The README has not been updated since the UI pivot away from USWDS — that rewrite is queued separately and is not blocking this plan.
- The decrypted COLA template under `scripts/.cola-template-*.pdf` is uncommitted; gitignore'ing it is a small chore separate from this work.

---

## Key Technical Decisions

**Required `application.json` at verify time.** Application is a required form field on the POST `/api/verify` body. The demo dropdown handles "user has nothing to upload" — that's the take-home demo flow. A future iteration could re-introduce a label-only path, but adding optionality now blurs the system's pivot point.

**Cross-check is its own module, not a Rule.** A Rule's signature is `check(extracted: ExtractedFields)`. Cross-check needs both sides; squeezing it into the Rule abstraction would either pollute every existing rule's signature or smuggle application data through a side channel. A sibling `cross-check/` module with its own `runCrossCheck(application, extracted)` keeps the Open/Closed property of the Rule list intact and gives cross-check space to grow its own comparators.

**Normalized exact for most fields; token-set for producer.** Reasoning from the scenario truth table:

| Field | Strategy | Why |
|---|---|---|
| brandName | normalized exact (casefold, trim, strip "LLC/Inc./Corp/Co./Ltd."suffix) | Scenario 02's "Silver Birch" vs "Silver Birch Premium" must fail. Casefold-only is too loose; substring is far too loose. |
| classType | normalized exact + alias map (e.g. "Distilled Spirits" ⇄ "Spirits") | Form Item 5 uses canonical TTB labels; label uses commercial names. |
| producer | token-set on company name + must-include city; state codes mapped | Scenario 05's "Calypso Sands Distilling Miami FL" vs "Tropical Spirits LLC San Juan PR" must fail; minor punctuation/word-order drift in same-company strings must pass. |
| wineVarietal | normalized exact (wine only) | Scenario 03 Cabernet vs Merlot. |
| wineAppellation | normalized exact (wine only) | Scenario 03 Napa Valley vs Sonoma County. |

The normalization helpers live in `src/lib/cross-check/normalize.ts`. They are deterministic, no LLM in the cross-check path — keeps the cross-check fast, predictable, and free of vendor cost on every request.

**Cross-check section threaded through the existing `VerificationReport`, not a sibling type.** Result type becomes `VerificationReport { overallStatus, crossCheck: CrossCheckReport, fields: Record<RuleId, RuleResult> }`. The client (and Zod schema) only learns one new top-level key. NDJSON line shape barely changes.

**Aggregate verdict logic.** `overallStatus = 'compliant'` iff every cross-check field is `match` or `not_applicable` AND every rule passes (`pass` or `uncertain`, NOT `fail`). Otherwise `needs_review`. `uncertain` rules do NOT flip to needs_review by themselves — current behavior preserved, only `fail` flips.

**Demo picker = client-side fetch.** Dropdown values are scenario slugs; on selection the component fetches `/samples/applications/{slug}/application.json` and `/samples/applications/{slug}/label.jpg`, constructs a `File` from the blob, populates upload state, and clears the dropdown. No new server route — assets already ship in `public/`. Middleware password gate already protects `/samples`.

---

## System-Wide Impact

| Surface | Change |
|---|---|
| `ExtractedFields` schema | + `wineVarietal: string \| null`, + `wineAppellation: string \| null` |
| Extractor prompt | New instructions for varietal/appellation; `PROMPT_VERSION` bump |
| `VerificationReport` | + `crossCheck: CrossCheckReport`; `overallStatus` aggregation logic |
| `ResultLine` Zod schema | Mirrors the new `VerificationReport` shape |
| Verify route handler | Reads `application` form field, validates, threads through `runVerification` |
| Result card | New accordion section above existing rule rows |
| Upload form | New demo scenario dropdown |
| Eval harness | New `cross-check-accuracy` evaluator targeting `public/samples/applications/` |
| Langfuse traces | Cross-check fields surface as a new trace attribute group (mirrors rule attributes) |
| Existing label-only test corpus | Unchanged — older evaluators continue to run; new evaluator is additive |

No client storage changes. No database (none exists). No auth changes (password gate already covers `/samples`).

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```
POST /api/verify (multipart form-data)
  ├── files[]: label image(s)
  └── application: JSON string

  → Application Zod parse → 400 on failure

  → for each label image (existing concurrency limit):
      ├── extractor.extract(buffer, mime)  →  ExtractedFields (now incl. wine fields)
      ├── runVerification(application, extracted)
      │     ├── runCrossCheck(application, extracted)
      │     │     ├── brandName: normalize-exact
      │     │     ├── classType: normalize-exact + alias map
      │     │     ├── producer: token-set + city/state
      │     │     ├── wineVarietal (if WINE): normalize-exact
      │     │     └── wineAppellation (if WINE): normalize-exact
      │     │     → CrossCheckReport { status, fields }
      │     ├── runRules(extracted)
      │     │     → Record<RuleId, RuleResult>
      │     └── aggregate: NEEDS_REVIEW if any mismatch or any fail
      └── emit NDJSON line: ResultLine { status: 'ok', report: { overallStatus, crossCheck, fields } }
```

Component shape:

```
src/lib/
  application/
    types.ts          ← Application Zod schema (mirrors application.json)
    loader.ts         ← parse + validate; throws on bad shape
  cross-check/
    types.ts          ← CrossCheckField (literal union of field ids),
                        CrossCheckFieldResult, CrossCheckReport
    normalize.ts      ← stripCorporateSuffix, tokenize, tokenSetEquals,
                        normalizeExact, classTypeAliases
    engine.ts         ← runCrossCheck(application, extracted): CrossCheckReport
  validation/
    engine.ts         ← runVerification(application, extracted): VerificationReport
                        (replaces runRules-only callers in route + tests)
    types.ts          ← VerificationReport now includes crossCheck
  extraction/
    types.ts          ← ExtractedFields extended with wineVarietal/wineAppellation
    prompt.ts         ← new section for wine fields; PROMPT_VERSION bump
  results/
    result-types.ts   ← ResultLineSchema updated to match VerificationReport
```

---

## Implementation Units

### U1. Extend `ExtractedFields` schema + extractor prompt

**Goal:** Add wine-only varietal + appellation fields to the extraction contract; teach the prompt to fill them only when the label reads as wine.

**Dependencies:** none.

**Files:**
- `src/lib/extraction/types.ts`
- `src/lib/extraction/types.test.ts`
- `src/lib/extraction/prompt.ts`

**Approach:**
- Add `wineVarietal: z.string().nullable()` and `wineAppellation: z.string().nullable()` to `ExtractedFieldsSchema`.
- Update `SYSTEM_PROMPT` with a new numbered rule: "Wine fields: if and only if `classType` reads as a wine (e.g. 'CABERNET SAUVIGNON', 'CHARDONNAY', 'MERLOT', 'RED WINE', any varietal), populate `wineVarietal` (the grape varietal as printed) and `wineAppellation` (the appellation of origin as printed, e.g. 'Napa Valley', 'Sonoma County', 'Willamette Valley'). For non-wine labels return null for both."
- Bump `PROMPT_VERSION` to `'2026-06-10.v3'`.

**Patterns to follow:**
- Existing nullable string fields in `ExtractedFieldsSchema`.
- Existing prompt rule numbering convention.

**Test scenarios:**
- ExtractedFieldsSchema parses a payload with non-null wineVarietal/wineAppellation.
- ExtractedFieldsSchema parses a payload with null wineVarietal/wineAppellation.
- ExtractedFieldsSchema rejects a payload where wineVarietal is a number (Zod TypeError).
- `PROMPT_VERSION` is a different string than the previous `'2026-06-10.v2'` so observability can distinguish runs.

**Verification:** Type-check passes. Unit tests pass.

---

### U2. Add `Application` Zod schema + loader

**Goal:** Server-validate the application JSON arriving from the client (or fetched by the demo picker) against a typed schema.

**Dependencies:** none.

**Files:**
- `src/lib/application/types.ts`
- `src/lib/application/types.test.ts`
- `src/lib/application/loader.ts`
- `src/lib/application/loader.test.ts`

**Approach:**
- Mirror the `application.json` shape from `public/samples/applications/README.md` and the 5 scenario fixtures: `ttbFormId`, `formRevision`, `scenarioId`, `expectedVerdict`, `form { ... }`, `crossCheckExpectations { brandName, classType, producer, countryOfOrigin, wineVarietal?, wineAppellation? }`, `labelOnlyExpectations { ... }`, `intentionalMismatches?: Array<...>`, `notes?: string`.
- `crossCheckExpectations.wineVarietal` and `wineAppellation` are optional (only present when wine).
- Loader exports `parseApplication(input: unknown): Application` — throws `InvalidApplicationError extends Error` with a Zod-formatted message on failure.
- All 5 scenario fixtures must parse successfully — this is the integration check.

**Patterns to follow:**
- `src/lib/extraction/types.ts` (Zod schema + inferred type pattern).
- `src/lib/safety/scrub-error.ts` for the custom error class pattern.

**Test scenarios:**
- Each of the 5 scenarios in `public/samples/applications/*/application.json` parses without error.
- Loader throws `InvalidApplicationError` when `form.brandName` is missing.
- Loader throws when `form.productType` is `"BEER"` (not in enum).
- Loader accepts an application without `intentionalMismatches` (optional field).
- Loader accepts an application with `wineVarietal: null` but rejects when the field is a number.

**Verification:** Unit tests pass. Schema covers all fields used by U3.

---

### U3. Build `cross-check/` module — types, normalize, engine

**Goal:** Deterministic per-field comparison engine.

**Dependencies:** U1 (uses `ExtractedFields` shape), U2 (uses `Application` shape).

**Files:**
- `src/lib/cross-check/types.ts`
- `src/lib/cross-check/normalize.ts`
- `src/lib/cross-check/normalize.test.ts`
- `src/lib/cross-check/engine.ts`
- `src/lib/cross-check/engine.test.ts`

**Approach:**
- `types.ts`: define `CrossCheckFieldId = 'brandName' | 'classType' | 'producer' | 'wineVarietal' | 'wineAppellation'`, `CrossCheckStatus = 'match' | 'mismatch' | 'not_on_label' | 'not_applicable'`, `CrossCheckFieldResult { id, label, status, applicationValue: string | null, labelValue: string | null, reason?: string }`, `CrossCheckReport { overallStatus: 'match' | 'mismatch', fields: Record<CrossCheckFieldId, CrossCheckFieldResult> }`.
- `normalize.ts`:
  - `normalizeExact(s)` = casefold → trim → collapse whitespace → strip diacritics → strip trailing corporate suffixes (`LLC`, `L.L.C.`, `Inc.`, `Inc`, `Corp.`, `Corp`, `Co.`, `Co`, `Ltd.`, `Ltd`, `Company`).
  - `tokenize(s)` = normalize then split on whitespace and punctuation, drop noise tokens (the, of, and, &).
  - `tokenSetEquals(a, b)` = `Set(tokenize(a))` deep-equal `Set(tokenize(b))`.
  - `producerMatches(applicationProducer, labelProducer)` = token-set match on the company-name span PLUS exact match on extracted city + state-code (normalized; state name → 2-letter code map).
  - `classTypeMatches(applicationClass, labelClass)` = normalized exact OR via an alias map (e.g. `"distilled spirits" ⇄ "spirits"`, `"malt beverages" ⇄ "beer" ⇄ "ale" ⇄ "ipa" ⇄ "lager"`).
- `engine.ts`: `runCrossCheck(application, extracted) → CrossCheckReport`. For each field id:
  - Read the application value from `application.crossCheckExpectations`.
  - Read the label value from `extracted`.
  - If application has no expectation for this field (wine fields when productType≠WINE): `not_applicable`.
  - If label value is null/missing but application expects one: `not_on_label`.
  - Otherwise apply the appropriate matcher → `match` or `mismatch`.
  - `overallStatus = 'mismatch'` iff any field is `mismatch` or `not_on_label`.

**Patterns to follow:**
- `src/lib/validation/engine.ts` for the engine shape (`runRules`).
- `src/lib/validation/types.ts` for the Result discriminated-union pattern.

**Test scenarios:**

`normalize.test.ts`:
- `normalizeExact('  Ridge Creek Distillery, LLC ')` === `'ridge creek distillery'` (or whatever the normalized form is — assert on the strip).
- `normalizeExact('Silver Birch')` !== `normalizeExact('Silver Birch Premium')` (covers scenario 02).
- `tokenize('Hawthorne Cellars, Inc.')` includes `'hawthorne'` and `'cellars'` but NOT `'inc'`.
- `tokenSetEquals('Northern Spirits Co., Portland, OR', 'Co. Northern Spirits Portland OR')` === true (word order tolerance).
- `producerMatches('Ridge Creek Distillery, LLC, Bardstown, KY', 'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky')` === true (covers scenario 01 happy path).
- `producerMatches('Calypso Sands Distilling, Inc., Miami, FL', 'Bottled by Tropical Spirits LLC, San Juan, PR')` === false (covers scenario 05).
- `classTypeMatches('DISTILLED SPIRITS', 'Kentucky Straight Bourbon Whiskey')` === true (alias map: bourbon → distilled spirits).
- `classTypeMatches('MALT BEVERAGES', 'India Pale Ale')` === true (alias map: IPA → malt beverages).

`engine.test.ts` (table-driven — one row per scenario fixture):
- Scenario 01 Ridge Creek Bourbon → all fields `match`, overallStatus `match`. Covers AE for scenario 01.
- Scenario 02 Silver Birch Vodka → brand `mismatch` (Silver Birch vs Silver Birch Premium), others `match`, overallStatus `mismatch`.
- Scenario 03 Hawthorne Cabernet → wineVarietal `mismatch`, wineAppellation `mismatch`, others `match`, overallStatus `mismatch`.
- Scenario 04 Ironwood IPA → all cross-check `match` (label-only failure is in the rules, not cross-check), overallStatus `match`. Wine fields `not_applicable`.
- Scenario 05 Calypso Rum → producer `mismatch`, others `match`, overallStatus `mismatch`. Wine fields `not_applicable`.
- `not_on_label` triggers: cross-check expects `wineVarietal: 'Cabernet Sauvignon'` but extracted `wineVarietal: null` → status `not_on_label`.

**Verification:** Unit tests pass. Each of the 5 scenario fixtures produces the expected per-field result table.

---

### U4. Update `VerificationReport` + add `runVerification`

**Goal:** Compose cross-check and label rules into one report; aggregate overall verdict.

**Dependencies:** U3.

**Files:**
- `src/lib/validation/types.ts`
- `src/lib/validation/engine.ts`
- `src/lib/validation/engine.test.ts`

**Approach:**
- `types.ts`: `VerificationReport` gains `crossCheck: CrossCheckReport`. Field order in the type matches display order (cross-check first).
- `engine.ts`: add `runVerification(application: Application, extracted: ExtractedFields): VerificationReport`. Calls `runCrossCheck` and `runRules`, aggregates:
  - `overallStatus = 'needs_review'` if `crossCheck.overallStatus === 'mismatch'` OR any rule returns `'fail'`.
  - Otherwise `'compliant'`.
  - `uncertain` rules do NOT flip to needs_review (preserves existing behavior).
- Keep `runRules` exported — useful for tests and the legacy evaluator path.

**Patterns to follow:**
- Existing `runRules` aggregation in `engine.ts`.
- Existing `RULES` constant export pattern.

**Test scenarios:**
- All cross-check `match` + all rules `pass` → `compliant`.
- All cross-check `match` + one rule `fail` → `needs_review`.
- One cross-check `mismatch` + all rules `pass` → `needs_review`.
- One cross-check `mismatch` + one rule `fail` → `needs_review`.
- All cross-check `match` + one rule `uncertain` → `compliant` (uncertain does not trip).
- Cross-check field results are passed through unchanged into the report.

**Verification:** Unit tests pass. No existing tests break — `runRules` callers still compile.

---

### U5. Update `ResultLine` schema + Zod contract

**Goal:** Make the NDJSON contract aware of the cross-check section so the client validates it loudly.

**Dependencies:** U4.

**Files:**
- `src/lib/results/result-types.ts`
- `src/lib/results/result-types.test.ts` (create if absent)

**Approach:**
- Extend `VerificationReportSchema` to include `crossCheck`. Add `CrossCheckReportSchema` and `CrossCheckFieldResultSchema` mirroring the types from U3.
- `ResultLine` discriminated union shape unchanged — just the nested `report` is richer.

**Patterns to follow:**
- Existing `ResultLineSchema` and `VerificationReportSchema` in `result-types.ts`.

**Test scenarios:**
- A `ResultLine` with status `'ok'` and a full `report` (cross-check + fields) parses cleanly.
- A `ResultLine` missing `report.crossCheck` fails Zod validation with a clear path.
- A `ResultLine` with `crossCheck.overallStatus: 'invalid'` (not in enum) fails Zod validation.

**Verification:** Unit tests pass.

---

### U6. Update verify route to accept application + thread cross-check

**Goal:** Route accepts `application` form field, validates it, runs the new pipeline.

**Dependencies:** U2, U4, U5.

**Files:**
- `src/app/api/verify/route.ts`
- `src/app/api/verify/route.test.ts` (create if absent — current repo has handler-level tests; otherwise integration test in U10)

**Approach:**
- Read `formData.get('application')` as a string; if absent → 400 `"Application JSON is required"`.
- Parse with `parseApplication(JSON.parse(applicationStr))`; on failure → 400 with the InvalidApplicationError message (already scrubbed if it would expose anything sensitive; application content is non-sensitive in this prototype).
- Replace `runRules(extracted)` with `runVerification(application, extracted)`.
- Existing per-label error handling, span tracing, scrubError, concurrency limit all unchanged.
- `withRequestSpan` attributes get a new `applicationScenarioId` (if present in the application).
- `withLabelSpan` attributes get a new `crossCheckStatus` (`'match'` or `'mismatch'`) for trace filtering.

**Patterns to follow:**
- Existing `formData.values()` loop for files.
- Existing `errorResponse` helper.
- Existing `withLabelSpan` attribute style.

**Test scenarios:**
- POST without `application` field → 400 with explicit error message.
- POST with malformed `application` JSON (`"{not json"`) → 400 with parse error.
- POST with `application` JSON that fails Zod (`form.brandName` missing) → 400 with field path.
- POST with valid `application` + 1 valid label → 200 NDJSON stream; first line has `report.crossCheck` populated.
- POST with valid `application` + 1 valid label that fails extraction → emits error line with scrubbed message.
- Concurrency: POST with valid `application` + N labels → all labels share the same `application` (no per-label re-parse).

**Verification:** All route tests pass. Smoke test against scenario 01 returns `compliant`.

---

### U7. Result card — cross-check accordion section

**Goal:** Surface the cross-check report in the result card above the existing rule rows.

**Dependencies:** U5 (ResultLine shape).

**Files:**
- `src/components/result-card.tsx`
- `src/components/result-card.test.tsx` (create if absent)

**Approach:**
- New section component `CrossCheckSection({ crossCheck })` rendered above the rules accordion.
- One row per field: label (e.g. "Brand name"), badge with status (match / mismatch / N/A), and a two-column display of the application value vs the label value when expanded.
- Stacked accordion pattern matching the existing rule rows — same `Disclosure` primitive.
- 6-dot summary header (existing pattern from `2026-06-10` UI work) gets a leading dot for cross-check overall status, then dots for each of the 6 rules. Optionally cluster the cross-check dot visually distinct (e.g. larger or labeled `XC`) so reviewers can spot which side failed.

**Patterns to follow:**
- Existing `RULES` mapping in `result-card.tsx`.
- Existing `Disclosure` accordion behavior and accent treatment.
- `WarningDiff` for the value-display pattern.

**Test scenarios:**
- Renders cross-check section with all-match data → all rows show `match` badge, overall dot is green.
- Renders with one mismatch → mismatch row is highlighted, overall dot is amber, accordion auto-opens for the failing field.
- Renders with wine fields when `wineVarietal` is `not_applicable` → row hidden or shows neutral "N/A — not a wine label" state (decide during implementation; either is acceptable as long as it's not confusing).
- Renders without a `crossCheck` field at all → does NOT crash (graceful degradation for old NDJSON shape).

**Verification:** Component tests pass. Visual smoke against scenario 03 shows two amber rows (varietal + appellation).

---

### U8. Demo scenario picker on upload form

**Goal:** "Try a scenario" dropdown that loads a scenario's `application.json` + `label.jpg` into the upload state.

**Dependencies:** U2 (Application shape — used for client-side type safety).

**Files:**
- `src/components/upload-form.tsx`
- `src/components/upload-form.test.tsx` (create if absent)
- `src/lib/application/loader.ts` (exported `loadScenarioFromServer(slug)` helper)

**Approach:**
- Hardcoded slug list in the component (5 scenarios — order matches the README truth table).
- `loadScenarioFromServer(slug)`:
  - `fetch('/samples/applications/' + slug + '/application.json')` → `parseApplication(json)`.
  - `fetch('/samples/applications/' + slug + '/label.jpg')` → Blob → File (with name `label.jpg` + correct MIME).
  - Returns `{ application, labelFile }`.
- Dropdown is a `select` element (no design system primitive needed); on selection, calls the loader, populates upload state, clears the dropdown to `""`.
- Submit handler unchanged — the application JSON gets serialized into the form data alongside the label file.

**Patterns to follow:**
- Existing upload-state management in `upload-form.tsx`.
- Existing file-validation flow — fetched files go through the same validation gate before submit.

**Test scenarios:**
- Selecting scenario 01 fetches both assets, validates the JSON, populates `state.application` + `state.files`.
- Selecting a scenario whose application.json returns a malformed body raises a visible error toast and does not corrupt state.
- After selection, dropdown resets to `""` so the next selection re-fires the change handler.
- Manual file upload still works (regression).

**Verification:** Component tests pass. Manual: opening `/` after login, picking scenario 01, hitting Verify, seeing a `compliant` report.

---

### U9. Eval evaluator — `cross-check-accuracy`

**Goal:** Regression test for the scenario truth table.

**Dependencies:** U2, U3, U4, U6 — needs the full pipeline.

**Files:**
- `evals/evaluators/cross-check-accuracy.ts`
- `evals/evaluators/cross-check-accuracy.test.ts`
- `evals/run.ts` (registration only)

**Approach:**
- Iterate `public/samples/applications/0N-*/` directories.
- For each scenario:
  - Load `application.json` via `parseApplication`.
  - Load `label.jpg` as a Buffer.
  - Run `extractor.extract(buffer, 'image/jpeg')` → `extracted`.
  - Run `runVerification(application, extracted)` → `report`.
  - Assert `report.overallStatus === scenario.expectedVerdict.toLowerCase()` (after case-normalizing the JSON's `"COMPLIANT"` / `"NEEDS_REVIEW"` strings).
  - For each entry in `scenario.intentionalMismatches`, assert the corresponding `report.crossCheck.fields[id].status === 'mismatch'` OR (for the gov-warning mismatch in scenario 04) the corresponding rule fails.
- Skip gracefully if `OPENAI_API_KEY` is unset (mirrors existing evaluator behavior).
- Emit a summary row per scenario: `scenarioId | expectedVerdict | actualVerdict | matched/total`.

**Patterns to follow:**
- `evals/evaluators/field-extraction-accuracy.ts` for the iterate-and-assert shape.
- `evals/dataset/index.ts` for the case-loading pattern.

**Test scenarios:**
- Unit test the evaluator's per-scenario assertion logic with synthetic `report` objects (no LLM call).
- Skipping behavior when `OPENAI_API_KEY` unset — evaluator returns early without throwing.
- Asserting on scenario 04: `expectedVerdict: NEEDS_REVIEW`, `intentionalMismatches[0].field === 'governmentWarning'` → checks `report.fields.governmentWarning.status === 'fail'`.

**Verification:** `npm run eval` runs the new evaluator alongside the legacy ones. Exits 0 against the scenario dataset.

---

### U10. End-to-end integration test — all 5 scenarios through the route

**Goal:** Single test file that runs the full pipeline (route handler in-process) against each scenario fixture and asserts the truth table.

**Dependencies:** U1–U9.

**Files:**
- `src/app/api/verify/route.scenarios.test.ts`
- `src/lib/test-helpers/mock-extractor.ts` (create if absent)

**Approach:**
- Mock the extractor to return deterministic `ExtractedFields` per scenario — derived from `application.crossCheckExpectations` + scenario-specific overrides for the `intentionalMismatches` (e.g. scenario 02 returns `brandName: 'Silver Birch Premium'`, scenario 03 returns `wineVarietal: 'Merlot'`, scenario 04 returns `governmentWarning.text: null`, scenario 05 returns `producer: 'Bottled by Tropical Spirits LLC · San Juan, Puerto Rico'` and `abv: '80 PROOF'`).
- For each scenario:
  - Build a `Request` with the scenario's `application.json` (as string form-field) and `label.jpg` (as File).
  - Invoke the route's `POST` directly (no HTTP roundtrip — Next route handlers are plain functions).
  - Parse the NDJSON response.
  - Assert `report.overallStatus === expectedVerdict.toLowerCase()`.
  - Assert every `intentionalMismatch` is reflected in either `report.crossCheck.fields` (`mismatch`) or `report.fields` (rule `fail`).
- No live OpenAI calls — fully deterministic, runs in CI without API keys.

**Patterns to follow:**
- Existing handler-level test pattern in the repo (if any) — otherwise build using `new Request()` and direct `POST(req)` invocation.
- `getExtractor` factory: extend it to honor an injected mock for tests (or use `vi.mock` of the factory module).

**Test scenarios:**
- All 5 scenarios pass their truth-table assertion.
- A negative control: if the mock extractor is swapped to return all-`null` fields, all scenarios surface a flood of `not_on_label` cross-check results and rule fails (sanity check that the test isn't tautological).

**Verification:** `npx vitest run src/app/api/verify/route.scenarios.test.ts` passes.

---

## Test Strategy

| Layer | Coverage |
|---|---|
| Unit (normalize) | All comparators with multi-row tables: identity, casefold, suffix-strip, word-order, diacritics. |
| Unit (cross-check engine) | One test per scenario fixture → per-field result table. |
| Unit (Application schema) | Each scenario fixture parses; per-field failure cases throw with clear paths. |
| Unit (validation engine) | Aggregation truth table for `runVerification(crossCheck × rules)`. |
| Unit (ResultLine schema) | Round-trip valid + invalid shapes. |
| Component (result card) | Happy path + mismatch + N/A wine fields + missing crossCheck (graceful). |
| Component (upload form) | Demo dropdown happy path + load failure + manual upload regression. |
| Route (handler-level) | Missing/invalid application → 400; valid input → 200 with cross-check in stream. |
| Integration (scenarios) | All 5 scenarios through the in-process route handler with a mock extractor, asserting `expectedVerdict` + `intentionalMismatches`. |
| Eval (live LLM, skip if no key) | Same 5 scenarios with the real extractor; surfaces drift in the model's extraction over time. |

Existing tests (18 test files, 198 passing per HANDOFF) must continue to pass. `runRules` is preserved as an exported function so any caller that doesn't have an application stays compilable.

---

## Verification Strategy

Plan is complete when:

1. All new unit tests pass.
2. All existing unit tests still pass (target: 198+ tests).
3. `npx tsc --noEmit` is clean.
4. `npx vitest run src/app/api/verify/route.scenarios.test.ts` passes — the 5-scenario integration test exercises the full pipeline end-to-end.
5. Manual: log in to the dev server, pick each of the 5 scenarios from the dropdown, click Verify, observe the truth table:
   - 01 → all green (cross-check + rules)
   - 02 → amber brand row + green rest
   - 03 → amber varietal + amber appellation + green rest
   - 04 → green cross-check + amber government warning rule
   - 05 → amber producer + amber ABV rule
6. The eval evaluator `cross-check-accuracy` is registered in `evals/run.ts` (live LLM run is optional and gated on `OPENAI_API_KEY`).

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Extractor's varietal/appellation extraction is unreliable on the generated label images | Medium | Medium | Scenario 03's images were generated with the varietal/appellation labels explicitly named in the codex prompt. If extraction drifts, the eval will surface it on the next run — and we can iterate the prompt without changing this plan. The cross-check engine treats `null` label values as `not_on_label`, which is the correct safety posture. |
| `producer` comparison is the most fuzzy field and a wrong-call here would tank the demo narrative | High | Medium | `producerMatches` has its own unit tests with all 5 scenarios + multiple word-order/punctuation perturbations. Scenario 05 is the must-fail case; scenario 01 (Ridge Creek matches "Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky") is the must-pass case. |
| `classType` alias map mis-classifies a real product type | Medium | Low | Map is small (3 broad TTB categories + their commercial aliases) and is unit-tested per row. If an edge case shows up, the cross-check returns `mismatch` and the reviewer sees it — fail-safe direction. |
| Mock extractor in the integration test diverges from real extractor behavior, hiding regressions | Medium | Medium | Live eval evaluator `cross-check-accuracy` (U9) runs against the same scenarios with the real LLM. Both layers together provide both determinism (integration) and ecological validity (eval). |
| The result card's new section reads as cluttered next to the existing rules | Low | Low | The cross-check section is visually distinct (above, smaller header) and the existing accordion pattern absorbs additional sections cleanly. If it feels cluttered after U7, design iteration is a small follow-up, not a blocker. |
| Forgetting to bump `PROMPT_VERSION` would silently merge old + new prompt traces | Low | Medium | Explicit U1 task. Unit test in U1 asserts the version is different from the prior `'2026-06-10.v2'`. |

---

## Dependencies / Prerequisites

- `public/samples/applications/0N-*/application.json` + `label.jpg` exist for all 5 scenarios. ✅ Confirmed shipped in this session.
- `public/samples/applications/0N-*/application.pdf` files exist for the visual demo (not consumed at runtime). ✅ Confirmed shipped in this session.
- `OPENAI_API_KEY` present in `.env.local` for the live eval run (optional).
- `npm install` clean; no new runtime dependencies — Zod, p-limit, lucide-react already installed.

---

## Sequencing Notes

- U1, U2 can run in parallel (independent schemas).
- U3 depends on both U1 and U2.
- U4 depends on U3.
- U5 depends on U4 (the schema mirrors the type).
- U6 depends on U2, U4, U5.
- U7 depends on U5.
- U8 depends on U2 (uses the Application loader).
- U9 depends on U2, U3, U4, U6 (full pipeline).
- U10 depends on everything else.

Suggested commit order: U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8 → U9 → U10. Each is a clean atomic commit; nothing else needs to land between them.

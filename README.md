# Label Check

A prototype that checks photos of alcohol beverage labels against TTB labeling
requirements. You drop in one label or a few hundred. Each one is read by a
vision model in about two seconds, checked against the rules every label must
meet, and handed to a reviewer, who can look closely, fix a misreading,
compare it with the application and approve or reject it.

**Live:** https://ttb-label-verify-phi.vercel.app. Click **Try 10 sample labels**
to see a batch run without uploading anything.

---

## What the stakeholders asked for, and what was built

| Who | Asked for | What the prototype does | Evidence |
|---|---|---|---|
| Sarah Chen | Results in about 5 seconds, or nobody will use it | One structured vision call per label; no OCR pass | Eval, 60 reads: **p50 1.6 s, p95 3.7 s** per label |
| Sarah Chen | Batch uploads for 200–300 label drops | The browser checks labels **6 at a time** (configurable), and you can add more while a batch runs | 30 reads: **59.7 s one by one, 10.1 s in a batch** |
| Sarah Chen | "Something my mother could figure out" | Three screens, large type, one primary action each; every status in words as well as colour; problems sorted first with a one-sentence reason | See [The screens](#the-screens) |
| Jenny Park | The warning must be exact, "GOVERNMENT WARNING:" in capitals | Wording compared word for word; a title-case or colon-less lead-in **fails**; before failing, a focused second read confirms it | Eval: title case and one added word fail every time; a compliant label's small type no longer causes a false failure |
| Jenny Park | Handle photos at an angle, with glare | The reader rates its own confidence and the image's legibility; an unreadable photo asks for a better one instead of guessing | Eval case: angled photo with glare |
| Dave Morrison | Judgment, e.g. "STONE'S THROW" vs "Stone's Throw" | Brand matching ignores case, punctuation and quote style; a mismatch means **"needs a look"**, never an automatic reject; a person always decides | Eval case: Stone's Throw |
| Marcus Williams | The network blocks many cloud endpoints | One provider interface with an **Azure OpenAI** implementation: one setting points it at Treasury's own Azure tenant | `LABEL_READER=azure-openai` |
| Marcus Williams | Standalone; no COLA integration | No COLA connection. Application values are typed in by the reviewer (optional) | — |

Measured by `npm run eval -- --repeat 3`: real API calls, each of the 10 sample
labels read 3 times one by one and 3 times in a batch, from a laptop. **60/60
conclusions correct.** Labels are read with `gpt-5.4-mini`, and a warning that looks wrong
is re-read with `gpt-5.4`. Times are server-side read time; the browser adds
upload time, which is small because it shrinks photos to 1600 px first.

---

## How it works

```
Browser                                       Server (one request per label)
───────                                       ──────────────────────────────
Drop photos ─► shrink to 1600 px JPEG         POST /api/labels
             ─► up to 6 requests at once ───►   ├─ reuse the reading if this exact image was read before
                                                ├─ LabelReader.read(image)        one vision call, structured output
                                                │    └─ warning looks wrong? re-read just the warning (stronger model)
                                                ├─ label rules                    deterministic, instant
                                                ├─ compare with application values (if entered)
                                                └─ save; return the verdict

Review screen ─ fix a reading / enter values ─► PATCH /api/labels/:id   re-assess, no model call
              ─ Approve / Reject ────────────► POST  /api/labels/:id/decision
```

The model's only job is to **read**: it returns every field exactly as printed,
the warning verbatim, how sure it is, and whether the photo is legible. Every
judgment after that is plain code that can be read, tested and explained. The
same reading always gets the same verdict, and changing a rule never needs the
model.

### What is checked on every label

| Check | Fails when | Needs a look when | Rule |
|---|---|---|---|
| Government warning | Missing; lead-in not exactly "GOVERNMENT WARNING:"; wording differs by even one word | Wording is exact but the lead-in may not be bold | 27 CFR §16.21–16.22 |
| Brand name | Not on the label | Hard to read | §4.33 / §5.63 / §7.51 |
| Class / type | Not on the label | Hard to read | §4.34 / §5.35 / §7.24 |
| Alcohol content | — | Missing (some wines and beers are exempt); shown only as proof; hard to read | §4.36 / §5.65 / §7.65 |
| Net contents | Not on the label | No recognizable unit; hard to read | §4.37 / §5.38 / §7.27 |
| Bottler / producer | Not on the label | Hard to read | §4.35 / §5.36 / §7.25 |
| Country of origin | — | The label names an importer but states no country | Imports only; inferred from the bottler's address when not stated |

**Verdicts.** Any failure gives **Problem found**. Anything that needs a look,
an application value that differs, or an unreadable photo gives **Needs a
look**. Otherwise the label **Looks good**. The verdict is a suggestion; the
reviewer approves or rejects.

**Comparing with the application** (optional, per label): brand ignores case
and punctuation, alcohol content compares the number (`45%` = `45% Alc./Vol.
(90 Proof)`), net contents compares the volume across units (`750 mL` =
`75 cL`), and producer and country use token and alias matching.

**Corrections.** If the model misread something, the reviewer fixes it on the
review screen. The original reading is never overwritten. The correction is
stored beside it with who made it and when, the rules re-run on the corrected
text, and the screen shows "Read as X · corrected by JP". Retyping an unsure
reading unchanged records that a person confirmed it.

### The screens

1. **Check labels.** A drop zone, then the batch: progress, counts, and one row
   per label with a thumbnail, a plain sentence about what matters, and its status.
2. **Review.** The photo, with hover-to-zoom; what needs attention, with a word-level
   diff of the warning; every field as read, with **Fix this reading**, beside an
   optional application value; large **Reject** and **Approve** buttons. The next
   label opens after each decision. Everything about an item is on one row:
   whether it passes and why not, an ⓘ with the requirement and its citation,
   what the label says (fixable), and the optional application value. Pointing
   at a row outlines that text on the photo (see below). The list of labels on
   the left can be hidden to give the photo more room.
3. **Decided.** Everything approved or rejected, with **Export to spreadsheet**.

### Where is it on the label?

On the review screen, pointing at a row in **Label details**, or focusing it
with the keyboard, outlines that text on the photo. Nothing is
drawn otherwise.

- The boxes come from **Tesseract OCR running in the reviewer's browser**,
  loaded only on the review page after it renders, and served from this site
  (`public/ocr`, copied from `node_modules` before `dev` and `build`), not a CDN.
- It reads the image twice, as uploaded (large display type) and enlarged
  (small type such as the warning), in Tesseract's sparse-text mode, which
  suits text scattered over artwork. When the same words appear twice (a
  brand in the headline and again in "Bottled by…"), the larger one is boxed.
- OCR is used only to *locate* the text the vision model already read
  ([locate-text.ts](src/lib/labels/locate-text.ts)). It never changes a verdict,
  and the 5-second check never waits for it.
- Short values must match every word, so a partial match never draws a
  misleading box. When text can't be found (decorative type, steep angles,
  small type on textured paper), the photo says "Couldn't find this on the
  photo" instead of guessing.
- Earlier, asking the model itself for boxes added 3–4 s per label and placed
  them poorly, which is why boxes come from OCR here.

---

## Decisions and trade-offs

- **One vision call instead of OCR.** The first version of this prototype used
  Tesseract OCR with an AI fallback. On the same machine it took **4.6–11.3 s**
  per label and struggled with decorative type. A single structured call to a
  small vision model takes about 2 s and handles angles and glare better. The
  cost is a dependency on a model provider, which is why the provider sits behind
  an interface with an Azure OpenAI implementation.
- **The model reads; code judges.** The main risk with a vision model is that
  it "helpfully" corrects a wrong warning into the right one. The prompt tells
  it to transcribe exactly, and the eval includes labels built to tempt
  correction: title case, and one extra word. Both are caught.
- **Confirm before failing the warning.** The warning is the smallest type on
  the label. Repeated eval runs showed the small model sometimes reading
  "alcohol" for "alcoholic" on a compliant label: 3 times in 14 reads. So when
  the warning looks wrong, a second call transcribes only the warning with a
  stronger model (`gpt-5.4`), and the label passes only if that read is the
  exact legal text. Measured: compliant small type 20/20 correct (was 11/14),
  and the deliberately wrong warnings still failed 20/20. The second call is
  made only for labels that would otherwise fail, so those take about 3–4 s.
- **Workers in the browser, not a server queue.** Each label is its own
  serverless request, so N requests in flight means N workers with no queue
  service to run. The trade-off: closing the tab stops the batch, and the page
  warns before that happens. A server-side queue is the production upgrade.
- **Bold type is a judgment.** The model reports whether the lead-in looks bold.
  Because that's a visual impression rather than text, a "not bold" answer means
  "needs a look", never an automatic failure.
- **Images are stored in Postgres** for the prototype, so a reviewer can reopen
  any label. Real use would move them to object storage with a retention policy.
- **Identical images are read once.** The reading is cached by content hash,
  prompt version and model, so re-uploading the same photo is instant and costs
  nothing.

## Assumptions

- A label image shows the label, front or back. Each image is checked on its own,
  so a warning printed only on the back label shows as missing on the front.
  Grouping front and back images into one item is the natural next step.
- The application values come from the agent's COLA screen, typed in when
  needed. In production they would come from COLA directly.
- Country of origin is only required on imports. When a label states no
  country, the bottler's address is used: a US state or territory (Portland,
  Oregon; Bardstown, KY; San Juan, Puerto Rico) means the product is domestic
  and passes. "Imported by…" with no country needs a look. An importer's US
  address never counts as the origin.

## Limitations and next steps

- Front and back images of one product, checked together.
- Application values in bulk, from a CSV now and from COLA later.
- A server-side queue so a batch survives closing the tab.
- Reviewer accounts. Today the reviewer's initials are optional and remembered per browser.
- Model output varies a little between runs. For example, on one beer label it
  has picked the brewery as the brand on one run and the beer name on another.
  Hence the eval's `--repeat` option, and the "Fix this reading" control.

---

## Running it

Requires Node 20+.

```bash
npm install
cp .env.example .env.local      # add OPENAI_API_KEY
npm run dev                     # http://localhost:3000
```

Without `DATABASE_URL`, results are kept in server memory, which is fine for a
local demo. With a Neon/Postgres URL, run `npm run db:migrate` first.

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` | Unit and API tests (no network; the reader is faked) |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm run eval` | Live eval on the sample labels: correctness and p50/p95 latency; fails if p95 > 5 s. `-- --repeat 3`, `-- --only calypso` |
| `npm run db:migrate` | Apply the Drizzle migrations to `DATABASE_URL` |
| `samples/labels/render.sh` | Regenerate the rendered test labels |

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `LABEL_READER` | `openai` | `openai`, `azure-openai`, or `fake` (offline demo) |
| `OPENAI_API_KEY`, `OPENAI_VLM_MODEL` | `gpt-5.4-mini` | OpenAI reader |
| `OPENAI_WARNING_MODEL` | `gpt-5.4` | Re-reads a warning that looks wrong |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | — | Azure OpenAI reader |
| `LABEL_READER_TIMEOUT_MS` | `15000` | Per-attempt ceiling for one label |
| `NEXT_PUBLIC_VERIFY_CONCURRENCY` | `6` | Labels checked at once in the browser |
| `DATABASE_URL` | — | Postgres; in-memory when unset |
| `LANGFUSE_*` | — | Optional tracing of model calls |

### Test labels

`public/samples/labels/` holds ten labels:

- five AI-generated in the earlier build (bourbon, vodka, wine, a beer missing
  its warning, a rum stating only proof)
- five rendered from [samples/labels/label.html](samples/labels/label.html),
  each with one known property: the brief's OLD TOM DISTILLERY sample, a
  title-case warning, a warning with one word added, the same label photographed
  at an angle with glare, and STONE'S THROW gin

[evals/cases.ts](evals/cases.ts) lists what a correct check concludes for each.
[docs/samples/label-prompts](docs/samples/label-prompts) has the image-generation
prompts for the AI-generated ones.

## Code layout

```
src/lib/labels/            the domain: no React, no HTTP
  reading.ts               the schema the model returns; the single contract
  label-reader.ts          LabelReader interface
  openai-compatible-reader.ts  the one implementation, for OpenAI and Azure OpenAI
  reader-factory.ts        picks the provider from the environment
  rules/                   one LabelRule per requirement, registered in rules/index.ts
  government-warning.ts    exact warning analysis
  compare-expected.ts      one matcher per application field
  corrections.ts           tracked reviewer corrections
  verdict.ts               the verdict policy, in one function
  verify-label.ts          assessReading / verifyLabel: the orchestration
  label-service.ts         check, update, decide; used by the routes
  label-record.ts          LabelRepository interface (+ memory and Drizzle implementations)
src/app/api/labels/        thin HTTP routes over label-service
src/components/labels/     the three screens and their parts
src/lib/concurrency/       the browser work queue
evals/                     the live eval
```

Earlier design notes from the COLA-PDF version are kept in `docs/plans/` and
`docs/brainstorms/` as history. Treat this README and the code as current.

# Sample PDFs

What's in this directory:

- `cola/` — 20 real TTB COLA Online export PDFs. The demo dropdown on the homepage reads from here. Filenames follow the TTB-id + brand-slug convention (`{14-digit-id}-{slug}.pdf`).
- `Blank-COLA-Form-1513.pdf` — the empty TTB Form 5100.31, useful as a reference when reading the extractor prompt.
- `applications/` — 5 legacy synthetic single-page fixtures (`01-ridge-creek-bourbon` through `05-calypso-rum`). The demo picker no longer surfaces them; they're kept only because `src/app/api/verify/route.scenarios.test.ts` asserts the truth table against `01`.
- `compliant-bourbon.jpg` — legacy image used by the original label-image eval at `evals/dataset/`. Not used by the live app.

If you add a new COLA PDF to `cola/`, the demo dropdown picks it up at next refresh — the picker reads the directory at render time, no manifest to update.

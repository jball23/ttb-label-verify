# Eval dataset images

The eval JSON files in the parent directory reference images that should live here. **These images are NOT committed** — they need to be sourced before `npm run eval` will produce real scores.

## How to source

For a take-home demo, the lowest-friction options are:

1. **Public-domain product photography.** Wikimedia Commons has plenty of alcohol-product photos. Filter by license. Crop to the front label.

2. **Generate with an image model.** GPT-4o image generation, Imagen, or Gemini can produce convincing label mockups. Tell the model what to include and what to omit (for the deliberately-broken cases).

3. **Use real labels you have.** A bottle from your shelf, photographed in good light.

For the deliberately-broken cases (`missing-warning`, `wrong-abv-format`, `partial-extraction`), use an image editor to alter a real label, or generate one with the specific omission/defect baked in.

## Expected files

- `compliant-bourbon.jpg` — fully-compliant straight bourbon label
- `missing-warning.jpg` — same label style, Government Warning removed
- `wrong-abv-format.jpg` — label with "forty percent alcohol" instead of "40% ALC/VOL"
- `partial-extraction.jpg` — front label only, producer/origin not visible
- `edge-case-foreign-import.jpg` — imported Scotch with "IMPORTED BY"

## What the eval runner does when images are missing

Each case with a missing image reports cleanly:
```
missing-warning            n/a       fail      0      Image not found at evals/dataset/images/missing-warning.jpg
```

The runner exits with code 3 if ALL cases are missing images, code 1 if scoring thresholds fail, code 0 on pass.

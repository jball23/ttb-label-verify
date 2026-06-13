# COLA Evidence Pipeline

Status: superseded
Date: 2026-06-12
Branch observed: feat/vlm-bbox / main at e9656a3

> Historical plan: this was written against another branch and an older
> deployed app. `README.md` documents the current deployable architecture.

## Problem

At the time this plan was written, the deployed app was a label-image verifier. It accepted PNG/JPG/WebP/PDF files, sent each file as one image payload to GPT-4o, received extracted strings, and ran label-only rules. That was not enough for the user need:

- Upload a full COLA application PDF, not just a cropped label image.
- Extract both application-side values and label-side values.
- Validate label values against the applicable TTB rules.
- Cross-check label values against the application where the application carries an expected value.
- Show where every value came from with a bbox.
- Show the source image region next to the extracted value so a reviewer can trust or reject it quickly.

This is hard because "field text", "validation result", and "source location" cannot be separate afterthoughts. They have to move through the system as one evidence object.

## Current Gaps

Current code shape:

- `src/lib/extraction/types.ts` has only `ExtractedFields`.
- `src/app/api/verify/route.ts` treats every upload as a single label image.
- `OpenAIExtractor.extract(image, mimeType)` has no page concept and no application-form concept.
- The OpenAI schema has no bbox fields.
- `runRules(extracted)` validates label presence and formatting only.
- `ResultLine.report` contains only rule results, not extracted form, label evidence, source pages, or bboxes.
- `ResultCard` renders extracted text and a thumbnail, but no field-level source crops.

Also, PDF uploads are accepted by validation but are not rendered into page images before vision extraction. Sending a PDF as an `image_url` is not a reliable COLA workflow.

## Target Shape

One upload produces one complete `VerificationReport`:

```ts
type PageRole = 'form' | 'label-front' | 'label-back' | 'label-other';

interface SourcePage {
  pageIndex: number;       // 0-indexed in API payload
  pageNumber: number;      // 1-indexed PDF page number
  role: PageRole;
  width: number;           // rendered pixels
  height: number;          // rendered pixels
  imageDataUrl: string;    // for prototype UI; blob storage later
}

interface EvidenceRegion {
  pageIndex: number;
  x: number;               // normalized 0..1
  y: number;
  w: number;
  h: number;
}

interface FieldEvidence {
  fieldId:
    | 'application.brandName'
    | 'application.fancifulName'
    | 'label.brandName'
    | 'label.fancifulName'
    | 'label.abv'
    | 'label.netContents'
    | 'label.producer'
    | 'label.countryOfOrigin'
    | 'label.governmentWarning';
  label: string;
  value: string | null;
  normalizedValue: string | null;
  source: 'pdf-text' | 'ocr' | 'vision';
  confidence: 'high' | 'medium' | 'low';
  regions: EvidenceRegion[];
  notes?: string[];
}

interface FieldCheck {
  status: 'pass' | 'warn' | 'fail' | 'uncertain';
  reason?: string;
  applicationEvidence?: FieldEvidence;
  labelEvidence?: FieldEvidence;
}

interface VerificationReport {
  overallStatus: 'compliant' | 'needs_review' | 'non_compliant';
  sourcePages: SourcePage[];
  fields: {
    brandName: FieldCheck;
    fancifulName: FieldCheck;
    abv: FieldCheck;
    netContents: FieldCheck;
    producerCountry: FieldCheck;
    governmentWarning: FieldCheck;
  };
}
```

The key rule: UI rows never hunt for a bbox by key after the fact. A row receives a `FieldCheck`, and the evidence objects inside it already contain the source page, extracted value, confidence, and bbox regions.

## Pipeline

1. Normalize the upload.
   - If the file is a PDF, render needed pages to PNG at 200 DPI.
   - If the file is an image, treat it as a single label page.
   - Classify PDF pages as `form`, `label-front`, `label-back`, or `label-other`.
   - Keep rendered page dimensions and image data URLs in the report for the prototype.

2. Extract application fields.
   - Prefer PDF text/widgets when available.
   - Fall back to OCR or vision when the form is flattened.
   - Required application fields for the user flow:
     - brand name
     - fanciful name
     - source/import indicator when available
     - applicant/producer context when available

3. Extract label fields.
   - Use a single structured vision call over all rendered source pages.
   - Return label values and normalized bboxes in the same JSON.
   - Required label fields:
     - brand name
     - fanciful name
     - alcohol by volume
     - net contents
     - producer
     - country of origin
     - government warning

4. Ground and verify bboxes.
   - For OCR/PDF-text fields, use native word/text geometry.
   - For vision fields, ask the model for normalized `x/y/w/h` per field.
   - Clamp bboxes to page bounds.
   - If a value exists but no bbox exists, do not mark it pass silently. Mark the field `uncertain` or `warn` with "source region unavailable".

5. Validate.
   - Government warning:
     - exact canonical text after whitespace normalization
     - prefix present as `GOVERNMENT WARNING:`
     - styling checks stay `uncertain` unless reliably measured
   - ABV:
     - present
     - recognized format such as `12.6% ALC/VOL`, `40% ALC./VOL.`, or proof where allowed
   - Net contents:
     - present
     - recognized units such as mL, L, fl oz, gal where applicable
   - Producer and country:
     - producer/bottler/importer statement present
     - country present for imports
     - domestic labels can infer USA only when the producer address is clearly US-based
   - Brand name:
     - label brand present
     - if application brand exists, compare with tolerant normalization
   - Fanciful name:
     - if application fanciful name exists, label should contain the same or a defensible variant
     - if application has no fanciful name, absence on label is pass

6. Render review UI.
   - Each field row is a two-column evidence row:
     - left: field label, extracted value, status, reason
     - right: source crop with bbox overlay
   - Clicking a crop opens the full source page with the bbox highlighted.
   - Multi-line fields, especially Government Warning, may show multiple regions or a merged crop.
   - Do not hide the source image behind a generic modal only. The source crop must be visible next to the value.

## OpenAI Prompt Shape

The vision call should return structured JSON similar to:

```json
{
  "application": {
    "brandName": {
      "value": "BOUCHARD AINE & FILS",
      "pageIndex": 0,
      "bbox": { "x": 0.10, "y": 0.34, "w": 0.25, "h": 0.03 },
      "confidence": "high"
    }
  },
  "label": {
    "abv": {
      "value": "12.6% BY VOL.",
      "pageIndex": 3,
      "bbox": { "x": 0.66, "y": 0.78, "w": 0.16, "h": 0.02 },
      "confidence": "medium"
    }
  }
}
```

Prompt rules:

- The model must choose from the supplied page indices only.
- Bboxes are normalized to the full rendered page image, not to a crop.
- If the field is not visible, return `value: null` and `bbox: null`.
- If the value is visible but the bbox is uncertain, return the best bbox and `confidence: low`.
- Government Warning text must be verbatim.

## Implementation Units

### U1. Upload Contract

Change the product language and validation from "label images" to "COLA application PDFs".

Files:

- `src/lib/upload/file-validation.ts`
- `src/components/upload-zone.tsx`
- `src/app/api/verify/route.ts`
- README

Acceptance:

- PDF is the primary path.
- Image upload remains only as a development fallback if desired.

### U2. PDF Rendering

Add server-side PDF page rendering.

Files:

- `src/lib/pdf/render.ts`
- `src/lib/pdf/render.test.ts`
- `next.config.mjs`
- `package.json`

Dependencies:

- `pdfjs-dist`
- `@napi-rs/canvas`

Acceptance:

- A real COLA PDF renders page PNGs.
- The renderer emits page roles.
- Tests assert page count, PNG magic bytes, and deterministic dimensions.

### U3. Evidence Schema

Replace string-only extraction with evidence-bearing extraction.

Files:

- `src/lib/extraction/types.ts`
- `src/lib/results/result-types.ts`
- `src/lib/extraction/prompt.ts`
- `src/lib/extraction/openai-extractor.ts`

Acceptance:

- Every extracted field can carry value, confidence, page, and bbox.
- Result stream validates with Zod.

### U4. Rule Engine

Make rules consume evidence, not raw strings.

Files:

- `src/lib/validation/types.ts`
- `src/lib/validation/engine.ts`
- `src/lib/validation/rules/*`

Acceptance:

- Field checks can cite application evidence and label evidence.
- Missing bbox prevents silent pass.
- Government warning failure can produce `non_compliant`.
- Other issues produce `needs_review` unless explicitly made critical.

### U5. Evidence UI

Show extracted value and source image side by side.

Files:

- `src/components/result-card.tsx`
- new `src/components/evidence-row.tsx`
- new `src/components/evidence-crop.tsx`
- `src/components/image-inspector.tsx`

Acceptance:

- Each required field row shows a source crop with a bbox overlay.
- Clicking opens full page image with the same bbox highlighted.
- PDF page images render for PDFs.

### U6. Evals

Create a small fixture set of real COLA PDFs and expected fields.

Files:

- `evals/dataset/cola/*.json`
- `evals/evaluators/field-extraction-accuracy.ts`
- new evaluator for bbox coverage

Acceptance:

- Field accuracy threshold is explicit.
- Bbox coverage threshold is explicit.
- Government warning exact match remains required.

## Why This Should Work

At the time this plan was written, the deployed app was trying to answer compliance questions from ungrounded strings. A reviewer needs grounded evidence. The right product primitive described here was not `ExtractedFields`; it was `FieldEvidence`.

Once every field carries its own source page and bbox, the rest of the system becomes simpler:

- Validation can explain itself.
- UI can show exactly what was read.
- Reviewers can decide quickly without hunting through the PDF.
- Missing or dubious evidence is surfaced as review risk instead of being hidden.

## Non-Goals For The First Fix

- No reviewer accounts.
- No archive or database persistence.
- No 200-document background queue.
- No custom object-detection model.
- No claim that model bboxes are legally definitive. They are reviewer evidence, not automated adjudication.

## Fastest Useful Path

The fastest path to a credible demo is:

1. Render COLA PDFs into page images.
2. Ask GPT-4o for the seven label/application fields plus bboxes in one structured call.
3. Validate into evidence-backed field checks.
4. Render field rows with crop thumbnails and bbox overlays.
5. Add evals for 5 to 10 real COLA PDFs.

This can be built without Tesseract first. OCR/PDF text grounding can be added after the VLM-bbox path works, to improve speed, cost, and bbox reliability.

# Tesseract.js spike — findings

Captured: 2026-06-11 evening, against `26086001000651-bouchard-aine-fils.pdf` (4-page export with full back-label artwork) and `26083001000522-chacewater.pdf` (3-page export with sparse back-label).

## Headline

**Tesseract.js works for this domain.** Real verdict-driving text on a back-label page is read with 86–95 confidence. OCR errors (`IMPARS`→`IMPAIRS`, `T50`→`750`) are recoverable via the fuzzy-token-set comparators already in `src/lib/cross-check/normalize.ts`. Total OCR latency runs ~3–5s per multi-page export, lower than the 8–15s of current GPT-4o vision calls.

## Per-PDF summary

### Bouchard (4 pages — wine export with back label artwork)

| Page | Kind | Words | Mean conf | OCR (ms) | What's on it |
|------|------|-------|-----------|----------|--------------|
| 1 | form | 426 | 91 | 2501 | TTB form items, applicant, brand, class/type |
| 2 | label | 173 | 89 | 996 | Form's "AFFIX LABELS" page (still form chrome) |
| 3 | label | 60 | 67 | 364 | Front label artwork — decorative wordmark, low conf |
| 4 | label | 195 | 80 | 899 | **Back label** — Government Warning, ABV, importer, country |

**Highlight-pattern hits on page 4 (the real back label):**
- `GOVERNMENT WARNING` ✓ (conf 86)
- `12.6%` ABV ✓ (conf 76)
- `IMPORTED BY` ✓ (conf 95)
- `PRODUCT OF` ✓ (conf 76)

**Exact GW text Tesseract read on page 4:**
```
GOVERNMENT WARNING : (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD
NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH
DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPARS YOUR
ABLITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.
```
- `IMPARS` → `IMPAIRS` (lost the I)
- `ABLITY` → `ABILITY` (lost the I)
- Both recoverable by fuzzy match against `GOVERNMENT_WARNING_CANONICAL`. Existing GW rule already uses case-insensitive comparison; a token-set approach handles single-char misreads.

**Sibling line with multiple critical fields:**
```
WHITE WINE - PRODUCT OF FRANCE - CONTAINS SULPHITES - ALC. 12.6% BY VOL. - T50 ML.
```
- Country: `FRANCE` ✓
- ABV: `12.6%` ✓
- Net contents: `T50 ML` (T misread for 7 → recoverable with regex `\d{2,4}\s*m?L\b` after normalization)

### Chacewater (3 pages — wine, sparse back label)

| Page | Kind | Words | Mean conf | What's on it |
|------|------|-------|-----------|--------------|
| 1 | form | 424 | 92 | Form items, "750ML BLOWN INTO GLASS" |
| 2 | label | 152 | 95 | Form chrome — "AFFIX LABELS BELOW", Image Type markers |
| 3 | label | 8 | 93 | Just the form footer — no back-label text on this export |

Chacewater's back label has no Government Warning text on the rendered PDF — the artwork is decorative-only. This is the **VLM-fallback case** the plan was designed for. A real reviewer would see no Tesseract-readable GW and the fallback would re-extract via GPT-4o.

## Implications for the plan

### KD1 needs to flip — scope-guardian was right

The plan's KD1 ("region-based form extraction: crop by hand-tuned TTB-item rects, OCR each crop separately") would be both **slower** (18 separate `worker.recognize()` calls each with fixed setup) and **lose layout context** (cross-region phrases break). Doc review's Scope Guardian Finding 5 flagged this; the spike confirms.

**Recommended new approach:** one full-page OCR per page, then assign words to fields by **bbox containment** within the TTB form's known item rectangles. Tesseract returns per-word bboxes; the assigner just does pure-function `wordBboxInRegion(word, region)` filtering. This:
- Runs 1× per page instead of 18×
- Keeps cross-region context (an item value that overflows its rect can still be matched)
- Reuses the same `worker.recognize()` call that already handles the label half
- Matches what the existing `pdfjs`-based AcroForm widget snap already does for form widget rects

### D1 (renderer Front/Back distinction) needs a real fix

The current classifier emits `kind: 'label'` for any page with a label marker OR text-light page with images. The spike shows this gives wrong answers:
- **Chacewater**: Page 2 (form chrome with "AFFIX LABELS") is tagged `label` even though it has no artwork. Page 3 has only 8 words — the real back label artwork has no readable text.
- **Bouchard**: Page 2 is similarly form chrome. The actual front label is Page 3 (60 words, low conf 67 — decorative wordmark). The actual back label with GW is Page 4 (195 words, conf 80).

**Recommended fix:** the classifier should detect `"Image Type: Brand (front)"` and `"Image Type: Back"` text markers and tag the **next** page (which holds the actual artwork) as `'label-front'` or `'label-back'`. Pages that contain the markers themselves are still form chrome and should be tagged `'form'` or a new `'label-affix-chrome'` (which the UI viewer ignores).

This is a real renderer change, not a docs tweak. Belongs as a new implementation unit before U4.

### Tesseract API confirmations

- Use `Tesseract.createWorker('eng')` + `worker.recognize(image, {}, { blocks: true, text: true })` — the convenience `Tesseract.recognize(image)` does NOT return blocks (= no bboxes). Plan's U3 worker module needs the `{ blocks: true }` opt-in.
- `result.data.blocks > paragraphs > lines > words`, each with `{ text, confidence, bbox: {x0, y0, x1, y1} }`. No flat `words[]` or `lines[]` at the top level.
- Worker init loads `eng.traineddata` (~10MB) once; subsequent recognize calls reuse it. Cold start adds ~500ms-1s.
- Confidence scale is 0–100. Mean confidence across pages: form ~91, real label artwork 80–95, decorative wordmarks 60–70.

### Fallback threshold

Based on the spike data, the right initial threshold is somewhere around **60 confidence**:
- Conf < 60 captures decorative wordmark misreads (Bouchard Page 3 had 60 mean conf with 67% of words below threshold — a classic fallback trigger)
- Conf 70–95 = trust Tesseract
- Tune in U5 against the baseline.

### Fields likely to need VLM fallback frequently

Based on the two-PDF spike:
- **Fanciful name / brand wordmark** — often stylized, low Tesseract confidence (Bouchard front label confidence ~60-70)
- **Decorative back-label producer attribution** — when "Produced by..." is in fine print on stylized art (Chacewater case)
- **Some net-contents formats** — `T50 ML` (T misread for 7); `cl` units (centiliters, common on European wine)

Fields Tesseract handles reliably:
- Government Warning (high contrast, standard typography)
- ABV percentage and "ALC. X% BY VOL."
- Importer / "PRODUCT OF X" attribution
- Form-page printed text

## Recommendations for the planning revisit

1. **Flip KD1**: full-page OCR + bbox-containment assignment, not 18 region crops.
2. **Add a new implementation unit (call it U3.5 or fold into U3)**: extend `src/lib/pdf/render.ts` page classifier to emit `'label-front'` / `'label-back'` based on `"Image Type:"` markers + the next-page convention. Resolves D1.
3. **Confirm KD2 (per-word bbox list per field)** — spike data confirms this matters: GW spans 5 lines, ABV value is two words. Single union rect would be one giant box.
4. **Bump fallback default threshold** to a conf-band-tuned value via U5.
5. **The 2 spike PDFs** chosen happen to cover both extremes (Bouchard = back-label-rich, Chacewater = back-label-sparse). U5 parity validation across all 20 should distinguish the two clusters and tune accordingly.

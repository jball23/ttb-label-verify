/**
 * OCR pipeline configuration — confidence threshold + landmark anchors for
 * the TTB Form 5100.31 form-field assigner.
 *
 * Plan unit: U4, KD1 (full-page OCR + bbox-containment assignment), KD4
 * (confidence threshold for VLM fallback).
 */
import { type FieldPath } from '../extraction/types';

/**
 * Below this mean-word-confidence, a Tesseract-extracted field falls back
 * to a single-call VLM re-extraction (KD3). Tuned in U5 against the 20-PDF
 * baseline; v1 default chosen from the U2 spike data (form pages clustered
 * 91-92 mean confidence, real label artwork 80-95, decorative wordmarks
 * 60-70 — a 60 cutoff lets the wordmark cases fall back while accepting
 * the artwork ones).
 */
export const OCR_CONFIDENCE_THRESHOLD = 60;

/**
 * Landmark-based form-field anchor. The TTB Form 5100.31 prints fixed
 * labels above or to the left of each item field; the assigner finds those
 * landmark words via OCR and then collects the value words in the
 * specified direction within `maxDistancePx`.
 *
 * This is landmark-based v1 (more robust to small layout shifts than
 * hand-tuned pixel rects, and easier to maintain). U5's parity gate will
 * surface anchors that need tuning or replacement with explicit rects.
 *
 * `marker` is a substring match against `WordRect.text` after whitespace
 * normalization. The first word whose text equals or ends-with the marker
 * is the landmark. Multi-word markers (e.g., 'BRAND NAME') are joined by
 * matching consecutive words on the same line.
 */
export interface FormLandmark {
  field: FieldPath;
  /** Printed label on the form. Multi-word landmarks match consecutive line words. */
  marker: string;
  /** Direction relative to the landmark where the value lives. */
  valueDirection: 'right' | 'below';
  /** Max pixel distance to search (200 DPI rendered page). */
  maxDistancePx?: number;
}

/**
 * Form-field landmarks for TTB Form 5100.31 (revision 06-2016). These cover
 * the verdict-driving + display-critical items; additional anchors can be
 * added incrementally as U5 surfaces extraction gaps.
 *
 * Ordering: applied top-down in pickPagesToRender — first matching landmark
 * wins for a given field.
 */
export const FORM_LANDMARKS: readonly FormLandmark[] = [
  // Item 2 — Plant Registry Number (varies by product type)
  { field: 'application.plantRegistryNumber', marker: 'PLANT REGISTRY', valueDirection: 'below' },
  // Item 4 — Serial Number
  { field: 'application.serialNumber', marker: 'SERIAL NUMBER', valueDirection: 'below' },
  // Item 5 — Type of Product
  { field: 'application.productType', marker: 'TYPE OF PRODUCT', valueDirection: 'below' },
  // Item 6 — Brand Name (verdict-critical via cross-check)
  { field: 'application.brandName', marker: 'BRAND NAME', valueDirection: 'below' },
  // Item 7 — Fanciful Name
  { field: 'application.fancifulName', marker: 'FANCIFUL NAME', valueDirection: 'below' },
  // Item 8 — Mailing Address
  { field: 'application.mailingAddress', marker: 'MAILING ADDRESS', valueDirection: 'below' },
  // Item 8a — Name and Address of Applicant
  { field: 'application.applicant.name', marker: 'NAME AND ADDRESS OF APPLICANT', valueDirection: 'below' },
  // Item 9 — Email
  { field: 'application.email', marker: 'E-MAIL ADDRESS', valueDirection: 'below' },
  // Item 10 — Phone
  { field: 'application.phone', marker: 'TELEPHONE', valueDirection: 'below' },
  // Item 11 — Type of Application (typically a checkbox group)
  { field: 'application.applicationType', marker: 'TYPE OF APPLICATION', valueDirection: 'below' },
  // Item 13 — Wine Appellation (wine only)
  { field: 'application.wineAppellation', marker: 'WINE APPELLATION', valueDirection: 'below' },
  // Item 14 — Grape Varietal
  { field: 'application.grapeVarietals', marker: 'GRAPE VARIETAL', valueDirection: 'below' },
  // Item 15 — Formula
  { field: 'application.formula', marker: 'FORMULA', valueDirection: 'below' },
  // Item 18 — Date of Application
  { field: 'application.applicationDate', marker: 'DATE OF APPLICATION', valueDirection: 'below' },
];

/**
 * Label-side regex / canonical-match patterns for the verdict-driving label
 * fields. The assigner runs full-page OCR on each label page, joins the
 * line texts, and pattern-matches against this table. Each hit collects the
 * matched line's words as the field's bbox source.
 *
 * GW uses a token-set comparison rather than regex because real labels
 * print typo-prone all-caps text — see `src/lib/cross-check/normalize.ts`
 * for the fuzzy matcher we reuse.
 */
export const LABEL_PATTERNS: ReadonlyArray<{
  field: FieldPath;
  pattern: RegExp;
}> = [
  // ABV — supports "12.6%", "12.6% ABV", "12.6% BY VOL.", "(80 PROOF)", etc.
  { field: 'label.abv', pattern: /\b\d{1,2}(?:\.\d{1,2})?\s*%/ },
  { field: 'label.abv', pattern: /\(\s*\d{1,3}\s+proof\s*\)/i },
  // Net contents — mL, L, fl oz, gal (per the existing net-contents rule)
  { field: 'label.netContents', pattern: /\b\d+(?:\.\d+)?\s*(?:m?l|fl\.?\s*oz|gal)\b/i },
  // Producer — "Produced by", "Bottled by", "Distilled by", "Imported by"
  {
    field: 'label.producer',
    pattern: /\b(?:produced|bottled|distilled|imported|brewed|vinified)\s+(?:and\s+\w+\s+)?by[: ]/i,
  },
  // Country of origin — "Product of {country}"
  { field: 'label.countryOfOrigin', pattern: /\bproduct\s+of\s+\S+/i },
];

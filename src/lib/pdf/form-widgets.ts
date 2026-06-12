import type {
  BoundingBox,
  ExtractedApplicationForm,
  FieldPath,
} from '../extraction/types';

/**
 * Deterministic AcroForm widget rectangles for TTB Form 5100.31 page 1.
 *
 * Captured via `scripts/inspect-form.mjs` against the unfilled template. The
 * scenario PDFs are flattened (widgets baked into static artwork), so the
 * widgets aren't present in the rendered file we hand to the vision LLM — but
 * the PRINTED CELL LOCATIONS are identical across every revision of the
 * template, so a lookup table gives us pixel-precise bboxes that don't depend
 * on the model's coordinate eyesight.
 *
 * Used by the route to OVERRIDE the model's application.* bboxes after
 * extraction. Label.* bboxes stay vision-LLM (no equivalent ground truth on
 * the artwork side) and surface with a dashed border when the model returns
 * low confidence.
 */

// Source page dimensions (pdf-lib reports for the scenario PDFs).
const PAGE_W = 612;
const PAGE_H = 1008;

// pdf-coord rects: { x, y, w, h } with (x,y) at the BOTTOM-LEFT corner of the
// widget, in PDF points (1pt = 1/72in). Pulled verbatim from inspect-form's
// dump.
interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pdfToNormalizedBBox(r: PdfRect): BoundingBox {
  return {
    x: r.x / PAGE_W,
    y: (PAGE_H - r.y - r.h) / PAGE_H,
    w: r.w / PAGE_W,
    h: r.h / PAGE_H,
  };
}

function unionRects(rects: PdfRect[]): PdfRect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Raw PDF-space rects. Treated as ground truth on every COLA F 5100.31.
const PDF_RECTS = {
  brandName: { x: 22, y: 779, w: 224, h: 16 },                  // Item 6
  fancifulName: { x: 22, y: 754, w: 224, h: 16 },               // Item 7
  applicantBlock: { x: 252, y: 811, w: 339, h: 57 },            // Item 8
  grapeVarietals: { x: 144, y: 722, w: 243, h: 22 },            // Item 10
  wineAppellation: { x: 21, y: 687, w: 364, h: 22 },            // Item 11
  phone: { x: 21, y: 654, w: 125, h: 20 },                      // Item 12
  email: { x: 148, y: 654, w: 239, h: 20 },                     // Item 13
  plantRegistryNumber: { x: 20, y: 860, w: 114, h: 24 },        // Item 2
  applicationDate: { x: 22, y: 496, w: 99, h: 23 },             // Item 16
  applicantSignatureName: { x: 353, y: 496, w: 237, h: 21 },    // Item 18
  // Item 4 SERIAL NUMBER = union of YEAR1/2 + SERIAL1-4 boxes.
  serialNumber: unionRects([
    { x: 20, y: 804, w: 18, h: 28 },
    { x: 40, y: 804, w: 18, h: 28 },
    { x: 65, y: 803, w: 18, h: 28 },
    { x: 83, y: 804, w: 18, h: 28 },
    { x: 102, y: 804, w: 18, h: 28 },
    { x: 120, y: 804, w: 18, h: 28 },
  ]),
  // Item 5 TYPE OF PRODUCT — the 3 checkboxes (only WINE has a real widget
  // rect; DS + MB use the calibrated printed positions from build-demo-pdfs).
  productType: unionRects([
    { x: 147, y: 830, w: 11, h: 10 }, // WINE
    { x: 147, y: 817, w: 11, h: 10 }, // DISTILLED SPIRITS
    { x: 147, y: 806, w: 11, h: 10 }, // MALT BEVERAGES
  ]),
  // Item 3 SOURCE OF PRODUCT — Domestic + Imported checkboxes.
  source: unionRects([
    { x: 140, y: 871, w: 10, h: 9 },  // Domestic
    { x: 202, y: 871, w: 11, h: 10 }, // Imported (calibrated)
  ]),
  // Item 14 TYPE OF APPLICATION — 4 checkboxes (a/b/c/d).
  applicationType: unionRects([
    { x: 397, y: 733, w: 8, h: 8 },
    { x: 397, y: 721, w: 7, h: 7 },
    { x: 398, y: 699, w: 7, h: 7 },
    { x: 397, y: 669, w: 8, h: 8 },
  ]),
} satisfies Record<string, PdfRect>;

// Map every FieldPath the dual extractor populates to the rect that should
// override the model's bbox. Paths absent from this map keep the model's bbox.
function rect(key: keyof typeof PDF_RECTS): BoundingBox {
  return pdfToNormalizedBBox(PDF_RECTS[key]);
}

export const FORM_WIDGET_RECTS: Partial<Record<FieldPath, BoundingBox>> = {
  'application.brandName': rect('brandName'),
  'application.fancifulName': rect('fancifulName'),
  // For cross-check, classType is rendered as the applicant's commercial class
  // designation but visually it lives in Item 5 (productType checkboxes) plus
  // Item 7 (fanciful name). Snap to the productType checkbox group so a click
  // on "Class / type designation" lands on the explicit regulatory category.
  'application.classType': rect('productType'),
  'application.productType': rect('productType'),
  'application.source': rect('source'),
  'application.phone': rect('phone'),
  'application.email': rect('email'),
  'application.applicationType': rect('applicationType'),
  'application.applicant.name': rect('applicantBlock'),
  'application.applicant.address': rect('applicantBlock'),
  'application.applicant.city': rect('applicantBlock'),
  'application.applicant.state': rect('applicantBlock'),
  'application.grapeVarietals': rect('grapeVarietals'),
  'application.wineAppellation': rect('wineAppellation'),
  'application.serialNumber': rect('serialNumber'),
  'application.plantRegistryNumber': rect('plantRegistryNumber'),
  'application.applicationDate': rect('applicationDate'),
  'application.applicantSignatureName': rect('applicantSignatureName'),
};

/**
 * Replace every application.* provenance entry with the deterministic widget
 * rect. Label.* entries pass through unchanged. Entries the model didn't
 * populate stay absent.
 */
type ProvenanceEntry = {
  page: number;
  bbox: BoundingBox;
  confidence: 'high' | 'medium' | 'low';
};
type ProvenanceLike = Partial<Record<FieldPath, ProvenanceEntry | null>>;

export function snapApplicationProvenance<T extends ProvenanceLike>(
  provenance: T,
): T {
  const next: ProvenanceLike = { ...provenance };
  for (const path of Object.keys(FORM_WIDGET_RECTS) as FieldPath[]) {
    const widgetBox = FORM_WIDGET_RECTS[path];
    if (!widgetBox) continue;
    const existing = next[path];
    if (!existing) continue;
    next[path] = {
      page: existing.page,
      bbox: widgetBox,
      // Widget-snapped bboxes are deterministic; promote to high confidence so
      // the UI doesn't dashed-border them based on the model's self-report.
      confidence: 'high',
    };
  }
  return next as T;
}

/**
 * Build application-side provenance from scratch, using the extracted form
 * values to decide which paths to populate and FORM_WIDGET_RECTS for the
 * deterministic coordinates.
 *
 * Used when EXTRACT_PROVENANCE is disabled: the model returned no provenance,
 * but we still want app-side click-to-highlight to work in the UI. Label-side
 * provenance stays empty in that mode — those clicks become inert.
 */
export function synthesizeApplicationProvenance(
  form: ExtractedApplicationForm,
): ProvenanceLike {
  const isPresent = (v: string | null | undefined): boolean =>
    typeof v === 'string' && v.trim().length > 0;

  // FieldPath → predicate that decides whether the corresponding form value
  // is populated enough to deserve a provenance entry.
  const populated: Partial<Record<FieldPath, boolean>> = {
    'application.repId': isPresent(form.repId),
    'application.brandName': isPresent(form.brandName),
    'application.fancifulName': isPresent(form.fancifulName),
    'application.mailingAddress': isPresent(form.mailingAddress),
    'application.formula': isPresent(form.formula),
    'application.containerWording': isPresent(form.containerWording),
    'application.classType': form.productType != null,
    'application.productType': form.productType != null,
    'application.source': form.source != null,
    'application.phone': isPresent(form.phone),
    'application.email': isPresent(form.email),
    'application.applicationType': isPresent(form.applicationType),
    'application.applicant.name': isPresent(form.applicant.name),
    'application.applicant.address': isPresent(form.applicant.addressLine1),
    'application.applicant.city': isPresent(form.applicant.city),
    'application.applicant.state': isPresent(form.applicant.state),
    'application.grapeVarietals': isPresent(form.grapeVarietals),
    'application.wineAppellation': isPresent(form.wineAppellation),
    'application.serialNumber': isPresent(form.serialNumber),
    'application.plantRegistryNumber': isPresent(form.plantRegistryNumber),
    'application.applicationDate': isPresent(form.applicationDate),
    'application.applicantSignatureName': isPresent(form.applicantSignatureName),
  };

  const out: ProvenanceLike = {};
  for (const [path, present] of Object.entries(populated) as [
    FieldPath,
    boolean,
  ][]) {
    if (!present) continue;
    const widgetBox = FORM_WIDGET_RECTS[path];
    if (!widgetBox) continue;
    out[path] = { page: 0, bbox: widgetBox, confidence: 'high' };
  }
  return out;
}

// TODO: re-calibrate PDF_RECTS against the current TTB Form 5100.31 revision
// in samples — the captured values target a 612×1008pt template but the
// real sample PDFs are 612×792pt with a different cell layout. Until that
// recalibration ships, the Tesseract pipeline uses landmark-text matching
// (see src/lib/extraction/tesseract-extractor.ts readValueAtLandmark) and
// only the legacy GPT-4o provenance path uses these rects via
// snapApplicationProvenance / synthesizeApplicationProvenance below.

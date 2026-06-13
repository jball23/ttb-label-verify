import { z } from 'zod';

const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const GovernmentWarningExtractionSchema = z.object({
  text: z.string().nullable(),
  appearsAllCaps: z.boolean().nullable(),
  appearsBold: z.boolean().nullable(),
});
export type GovernmentWarningExtraction = z.infer<
  typeof GovernmentWarningExtractionSchema
>;

export const ExtractedFieldsSchema = z.object({
  brandName: z.string().nullable(),
  abv: z.string().nullable(),
  governmentWarning: GovernmentWarningExtractionSchema,
  netContents: z.string().nullable(),
  classType: z.string().nullable(),
  producer: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  wineVarietal: z.string().nullable(),
  wineAppellation: z.string().nullable(),
  extractionConfidence: ConfidenceSchema,
});
export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;

// Bare form-half of the COLA application that the extractor reads from the
// rendered page. Fields are nullable because the model may not see every cell
// clearly; downstream synthesis fills sensible defaults where appropriate.
const ExtractedApplicantSchema = z.object({
  name: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
});

export const ExtractedApplicationFormSchema = z.object({
  repId: z.string().nullable(),
  plantRegistryNumber: z.string().nullable(),
  source: z.enum(['Domestic', 'Imported']).nullable(),
  serialNumber: z.string().nullable(),
  productType: z.enum(['WINE', 'DISTILLED SPIRITS', 'MALT BEVERAGES']).nullable(),
  brandName: z.string().nullable(),
  fancifulName: z.string().nullable(),
  applicant: ExtractedApplicantSchema,
  mailingAddress: z.string().nullable(),
  formula: z.string().nullable(),
  grapeVarietals: z.string().nullable(),
  wineAppellation: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  applicationType: z.string().nullable(),
  containerWording: z.string().nullable(),
  applicationDate: z.string().nullable(),
  applicantSignatureName: z.string().nullable(),
});
export type ExtractedApplicationForm = z.infer<typeof ExtractedApplicationFormSchema>;

// All field paths that can carry source metadata. PDF/Tesseract values use
// FieldBbox entries; the legacy OpenAI extractor can still populate
// ProvenanceMap entries when EXTRACT_PROVENANCE is enabled.
export const FIELD_PATHS = [
  'application.repId',
  'application.brandName',
  'application.fancifulName',
  'application.productType',
  'application.classType',
  'application.source',
  'application.applicant.name',
  'application.applicant.address',
  'application.applicant.city',
  'application.applicant.state',
  'application.mailingAddress',
  'application.formula',
  'application.grapeVarietals',
  'application.wineAppellation',
  'application.serialNumber',
  'application.plantRegistryNumber',
  'application.phone',
  'application.email',
  'application.applicationType',
  'application.containerWording',
  'application.applicationDate',
  'application.applicantSignatureName',
  'label.brandName',
  'label.abv',
  'label.governmentWarning',
  'label.netContents',
  'label.classType',
  'label.producer',
  'label.countryOfOrigin',
  'label.wineVarietal',
  'label.wineAppellation',
] as const;

export const FieldPathSchema = z.enum(FIELD_PATHS);
export type FieldPath = z.infer<typeof FieldPathSchema>;

export const BoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const FieldProvenanceSchema = z.object({
  page: z.number().int().nonnegative(),
  bbox: BoundingBoxSchema,
  confidence: ConfidenceSchema,
});
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

// Legacy full-document OpenAI provenance map. The default Tesseract pipeline
// writes source locations to FieldBboxes instead.
const provenanceShape = FIELD_PATHS.reduce(
  (acc, path) => {
    acc[path] = FieldProvenanceSchema.nullable().optional();
    return acc;
  },
  {} as Record<FieldPath, z.ZodOptional<z.ZodNullable<typeof FieldProvenanceSchema>>>,
);
export const ProvenanceMapSchema = z.object(provenanceShape).strict();
export type ProvenanceMap = z.infer<typeof ProvenanceMapSchema>;

/**
 * Per-word OCR/PDF-text result. Coordinates are in rendered PDF-page pixel
 * space at the render DPI (currently 200 DPI). The source viewer overlays
 * these on the full PDF page image.
 */
export const WordRectSchema = z.object({
  text: z.string(),
  /** 0-100, Tesseract confidence. */
  confidence: z.number().min(0).max(100),
  /** Pixel-space bbox: top-left (x0,y0), bottom-right (x1,y1). */
  bbox: z.object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
  }),
});
export type WordRect = z.infer<typeof WordRectSchema>;

/**
 * Bbox sidecar for one extracted field. Carries every word the field's
 * value was assembled from, plus a `source` discriminant.
 *
 * - `source: 'pdf'` — the value came from the PDF text layer; `words` are
 *   synthetic per-word rects mapped into the same 200-DPI coordinate space
 *   as Tesseract so the detail view can highlight them normally.
 * - `source: 'tesseract'` — the value came from OCR; `words` lists per-word
 *   rects rather than a single union; `meanConfidence` is the average word
 *   confidence (0-100).
 * - `source: 'vlm'` — the value came from the OpenAI VLM fallback. No
 *   bboxes are available; `words` is `[]` and `meanConfidence` is `null`.
 *   The detail view renders this case with a "source not available" overlay
 *   when the user clicks the field.
 */
export const FieldBboxSchema = z.object({
  /** 1-indexed PDF page the bboxes are relative to. */
  page: z.number().int().positive(),
  source: z.enum(['pdf', 'tesseract', 'vlm']),
  words: z.array(WordRectSchema),
  meanConfidence: z.number().min(0).max(100).nullable(),
});
export type FieldBbox = z.infer<typeof FieldBboxSchema>;

/**
 * Map from FieldPath → FieldBbox. One entry per field that was extracted.
 * Fields that the extractor saw `null` for don't appear in the map.
 *
 * Primary source-location map for the current Tesseract/PDF-text pipeline.
 */
const fieldBboxesShape = FIELD_PATHS.reduce(
  (acc, path) => {
    acc[path] = FieldBboxSchema.optional();
    return acc;
  },
  {} as Record<FieldPath, z.ZodOptional<typeof FieldBboxSchema>>,
);
export const FieldBboxesSchema = z.object(fieldBboxesShape).strict();
export type FieldBboxes = z.infer<typeof FieldBboxesSchema>;

export const ExtractedDocumentSchema = z.object({
  application: ExtractedApplicationFormSchema,
  label: ExtractedFieldsSchema,
  provenance: ProvenanceMapSchema,
  /** Field-level PDF/OCR/VLM source sidecar used by the detail view. */
  bboxes: FieldBboxesSchema.optional(),
});

// Lean variant the model is asked for when EXTRACT_PROVENANCE=false. Skips
// the provenance map entirely so the model doesn't burn output tokens on
// ~27 bbox entries. The extractor post-pads `provenance: {}` so the
// in-memory ExtractedDocument shape stays consistent.
export const ExtractedDocumentNoProvenanceSchema = z.object({
  application: ExtractedApplicationFormSchema,
  label: ExtractedFieldsSchema,
});
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export interface ParsedApplicationFormPrepass {
  application: ExtractedApplicationForm;
  bboxes: FieldBboxes;
}

export interface ExtractorOptions {
  parsedForm?: ParsedApplicationFormPrepass | null;
  trace?: (stage: string, extra?: Record<string, unknown>) => void;
}

// The provider abstraction the verify route depends on. The input is the set
// of rendered pages the verifier needs (form fields + label artwork); for a
// single-page fixture that's one PNG, for a real TTB COLA Online export it
// can be two or more. Each page carries its renderer-emitted kind
// ('form' | 'label-front' | 'label-back' | ...) so the extractor can route
// field assignment without re-classifying.
//
// The response still carries one application + label + (optional) bboxes —
// the extractor is expected to find each field wherever it appears across
// the supplied pages.
export interface DocumentExtractor {
  readonly providerName: string;
  readonly modelId: string;
  extract(
    pages: ExtractorPage[],
    options?: ExtractorOptions,
  ): Promise<ExtractedDocument>;
}

/**
 * Minimal page descriptor passed to the extractor. Structurally compatible
 * with `RenderedPage` from `../pdf/render`, but typed here to avoid a circular
 * import from extraction → pdf → extraction.
 */
export interface ExtractorPage {
  pageNumber: number;
  kind: string;
  png: Buffer;
}

// Kept as an alias so legacy imports that referenced LabelExtractor compile.
// The interface is identical now that the contract returns ExtractedDocument.
export type LabelExtractor = DocumentExtractor;

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

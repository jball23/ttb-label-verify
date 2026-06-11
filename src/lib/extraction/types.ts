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

// All the field paths that can carry provenance. The model returns a bbox for
// each path it populates; paths it leaves null are omitted from the map.
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

// Provenance arrives as a fixed-shape object with one optional key per
// FieldPath. We use an explicit shape (rather than `z.record`) because OpenAI
// structured-output's JSON Schema dialect doesn't support the `propertyNames`
// constraint Zod emits for `record(enum, value)` — the request 400s with
// "'propertyNames' is not permitted" at validation time.
const provenanceShape = FIELD_PATHS.reduce(
  (acc, path) => {
    acc[path] = FieldProvenanceSchema.nullable().optional();
    return acc;
  },
  {} as Record<FieldPath, z.ZodOptional<z.ZodNullable<typeof FieldProvenanceSchema>>>,
);
export const ProvenanceMapSchema = z.object(provenanceShape).strict();
export type ProvenanceMap = z.infer<typeof ProvenanceMapSchema>;

export const ExtractedDocumentSchema = z.object({
  application: ExtractedApplicationFormSchema,
  label: ExtractedFieldsSchema,
  provenance: ProvenanceMapSchema,
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

// The provider abstraction the verify route depends on. The input is the set
// of rendered pages the verifier needs (form fields + label artwork); for a
// single-page fixture that's one PNG, for a real TTB COLA Online export it
// can be two or more. The response still carries one application + label +
// provenance — the model is expected to find each field wherever it appears
// across the supplied pages.
export interface DocumentExtractor {
  readonly providerName: string;
  readonly modelId: string;
  extract(pngBuffers: Buffer[]): Promise<ExtractedDocument>;
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

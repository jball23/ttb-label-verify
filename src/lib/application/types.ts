import { z } from 'zod';

/**
 * The structured shape of a filled-out TTB F 5100.31 COLA application as
 * accepted by the verify route.
 *
 * Mirrors the JSON shape of `application.json` under each scenario folder in
 * `public/samples/applications/`.
 * Server-validated by `parseApplication` so malformed input fails loudly at the
 * route boundary rather than producing confused cross-check output downstream.
 */

const ExpectedVerdictSchema = z.enum(['COMPLIANT', 'NEEDS_REVIEW']);
export type ExpectedVerdict = z.infer<typeof ExpectedVerdictSchema>;

const ProductTypeSchema = z.enum([
  'WINE',
  'DISTILLED SPIRITS',
  'MALT BEVERAGES',
]);
export type ApplicationProductType = z.infer<typeof ProductTypeSchema>;

const SourceSchema = z.enum(['Domestic', 'Imported']);

const ApplicationTypeSchema = z.enum([
  'CERTIFICATE_OF_LABEL_APPROVAL',
  'CERTIFICATE_OF_EXEMPTION',
  'DISTINCTIVE_LIQUOR_BOTTLE_APPROVAL',
  'RESUBMISSION_AFTER_REJECTION',
]);

const ApplicantSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
});

const ApplicationFormSchema = z.object({
  repId: z.string().nullable(),
  plantRegistryNumber: z.string(),
  source: SourceSchema,
  serialNumber: z.string(),
  productType: ProductTypeSchema,
  brandName: z.string(),
  fancifulName: z.string().nullable(),
  applicant: ApplicantSchema,
  mailingAddress: ApplicantSchema.nullable(),
  formulaId: z.string().nullable(),
  grapeVarietals: z.string().nullable(),
  wineAppellation: z.string().nullable(),
  phone: z.string(),
  email: z.string(),
  applicationType: ApplicationTypeSchema,
  containerInfo: z.unknown().nullable(),
  applicationDate: z.string(),
  applicantSignatureName: z.string(),
});

const CrossCheckExpectationsSchema = z.object({
  brandName: z.string(),
  classType: z.string(),
  producer: z.string(),
  countryOfOrigin: z.string(),
  wineVarietal: z.string().optional(),
  wineAppellation: z.string().optional(),
});

const LabelOnlyExpectationsSchema = z.object({
  abv: z.string(),
  netContents: z.string(),
  governmentWarning: z.enum(['PRESENT_AND_VERBATIM', 'ABSENT']),
});

const IntentionalMismatchSchema = z.object({
  field: z.string(),
  expectedFromApplication: z.string(),
  appearsOnLabelAs: z.string(),
  rationale: z.string(),
});

export const ApplicationSchema = z.object({
  ttbFormId: z.string(),
  formRevision: z.string(),
  scenarioId: z.string(),
  expectedVerdict: ExpectedVerdictSchema,
  form: ApplicationFormSchema,
  crossCheckExpectations: CrossCheckExpectationsSchema,
  labelOnlyExpectations: LabelOnlyExpectationsSchema,
  intentionalMismatches: z.array(IntentionalMismatchSchema).optional(),
  notes: z.string().optional(),
});

export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationForm = z.infer<typeof ApplicationFormSchema>;
export type CrossCheckExpectations = z.infer<
  typeof CrossCheckExpectationsSchema
>;
export type IntentionalMismatch = z.infer<typeof IntentionalMismatchSchema>;

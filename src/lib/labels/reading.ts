import { z } from 'zod';

/**
 * What a label reader returns for one label image. This schema is the single
 * contract between the vision model (it is sent as the structured-output
 * format) and everything downstream: rules, comparisons, persistence, UI.
 */

export const LABEL_FIELD_IDS = [
  'brandName',
  'classType',
  'alcoholContent',
  'netContents',
  'producer',
  'countryOfOrigin',
] as const;

export type LabelFieldId = (typeof LABEL_FIELD_IDS)[number];

export const LABEL_FIELD_LABELS: Record<LabelFieldId, string> = {
  brandName: 'Brand name',
  classType: 'Class / type',
  alcoholContent: 'Alcohol content',
  netContents: 'Net contents',
  producer: 'Bottler / producer name and address',
  countryOfOrigin: 'Country of origin',
};

const ReadFieldSchema = z.object({
  /** Text exactly as printed on the label, or null when it is not there. */
  value: z.string().nullable(),
  /** 'low' when glare, blur, angle or small type made the reading unsure. */
  confidence: z.enum(['high', 'low']),
});

export type ReadField = z.infer<typeof ReadFieldSchema>;

const fieldsShape = Object.fromEntries(
  LABEL_FIELD_IDS.map((id) => [id, ReadFieldSchema]),
) as Record<LabelFieldId, typeof ReadFieldSchema>;

export const LabelReadingSchema = z.object({
  fields: z.object(fieldsShape),
  governmentWarning: z.object({
    /** The full warning transcribed verbatim — original case and wording. */
    verbatimText: z.string().nullable(),
    /** Whether "GOVERNMENT WARNING:" looks bold; null when it cannot be told. */
    prefixAppearsBold: z.boolean().nullable(),
  }),
  imageQuality: z.object({
    /** False when the label cannot be read reliably enough to verify. */
    legible: z.boolean(),
    /** Plain-language problems, e.g. "glare over the warning text". */
    issues: z.array(z.string()),
  }),
});

export type LabelReading = z.infer<typeof LabelReadingSchema>;

/** Models sometimes answer "" or "  " for "not on the label"; treat blanks as absent. */
export function normalizeReading(reading: LabelReading): LabelReading {
  const blankToNull = (value: string | null) => (value?.trim() ? value : null);
  return {
    ...reading,
    fields: Object.fromEntries(
      LABEL_FIELD_IDS.map((id) => [
        id,
        { ...reading.fields[id], value: blankToNull(reading.fields[id].value) },
      ]),
    ) as LabelReading['fields'],
    governmentWarning: {
      ...reading.governmentWarning,
      verbatimText: blankToNull(reading.governmentWarning.verbatimText),
    },
  };
}

/** Values from the application, entered by the reviewer. All optional. */
export const ExpectedValuesSchema = z
  .object(
    Object.fromEntries(
      LABEL_FIELD_IDS.map((id) => [id, z.string().trim().max(500).optional()]),
    ) as Record<LabelFieldId, z.ZodOptional<z.ZodString>>,
  )
  .strict();

export type ExpectedValues = z.infer<typeof ExpectedValuesSchema>;

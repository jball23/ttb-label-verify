import { z } from 'zod';

/**
 * The structured shape we extract from a label image.
 *
 * Each field is nullable — the model must return `null` when a field is genuinely
 * absent from the label, never invent a plausible value. The Government Warning
 * carries sibling judgment fields for visual styling (bold, all-caps) that the
 * model is asked to evaluate honestly.
 */

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

/**
 * The provider abstraction the verify route depends on. Implementations:
 *   - OpenAIExtractor (live in prototype)
 *   - AzureOpenAIExtractor (stub for documented production swap path)
 */
export interface LabelExtractor {
  readonly providerName: string;
  extract(image: Buffer, mimeType: string): Promise<ExtractedFields>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

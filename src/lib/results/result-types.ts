import { z } from 'zod';
import {
  ExtractedApplicationFormSchema,
  ExtractedFieldsSchema,
  ProvenanceMapSchema,
} from '../extraction/types';

/**
 * The contract for one NDJSON line streamed from /api/verify back to the client.
 *
 * Shared between server (the route handler) and client (the stream-consumer in U7).
 * Zod schema is exported so the client can validate every line and catch contract
 * drift loudly rather than silently rendering broken results.
 */

const RuleResultSchema = z.object({
  status: z.enum(['pass', 'fail', 'uncertain']),
  reason: z.string().optional(),
  extractedValue: z.string().nullable().optional(),
});

const CrossCheckFieldIdSchema = z.enum([
  'brandName',
  'classType',
  'producer',
  'countryOfOrigin',
  'wineVarietal',
  'wineAppellation',
]);

const CrossCheckFieldResultSchema = z.object({
  id: CrossCheckFieldIdSchema,
  label: z.string(),
  status: z.enum(['match', 'mismatch', 'not_on_label', 'not_applicable']),
  applicationValue: z.string().nullable(),
  labelValue: z.string().nullable(),
  reason: z.string().optional(),
});

const CrossCheckReportSchema = z.object({
  overallStatus: z.enum(['match', 'mismatch']),
  fields: z.record(CrossCheckFieldIdSchema, CrossCheckFieldResultSchema),
});

const VerificationReportSchema = z.object({
  overallStatus: z.enum(['compliant', 'needs_review']),
  crossCheck: CrossCheckReportSchema,
  fields: z.record(z.string(), RuleResultSchema),
  provenance: ProvenanceMapSchema,
  extractedForm: ExtractedApplicationFormSchema,
  extractedLabel: ExtractedFieldsSchema,
});

export const ResultLineSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    index: z.number().int().nonnegative(),
    filename: z.string(),
    durationMs: z.number().nonnegative(),
    report: VerificationReportSchema,
    applicationId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    status: z.literal('error'),
    index: z.number().int().nonnegative(),
    filename: z.string(),
    durationMs: z.number().nonnegative(),
    errorMessage: z.string(),
  }),
]);

export type ResultLine = z.infer<typeof ResultLineSchema>;

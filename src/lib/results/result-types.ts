import { z } from 'zod';

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

const VerificationReportSchema = z.object({
  overallStatus: z.enum(['compliant', 'needs_review']),
  fields: z.record(z.string(), RuleResultSchema),
});

export const ResultLineSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    index: z.number().int().nonnegative(),
    filename: z.string(),
    durationMs: z.number().nonnegative(),
    report: VerificationReportSchema,
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

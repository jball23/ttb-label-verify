import { z } from 'zod';

/**
 * Environment-variable contract for the app. Everything is optional here so
 * the app boots for local demos; the label reader factory reports a missing
 * provider key when a label is first checked.
 */

/** An unset variable often arrives as an empty string (e.g. from Vercel); treat it as unset. */
const blankAsUnset = (value: unknown) => (value === '' ? undefined : value);
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blankAsUnset, schema.optional());

const baseSchema = z.object({
  /** Which label reader verifies images. `fake` is for offline demos and tests. */
  LABEL_READER: z.preprocess(
    blankAsUnset,
    z.enum(['openai', 'azure-openai', 'fake']).default('openai'),
  ),
  LABEL_READER_TIMEOUT_MS: z.preprocess(
    blankAsUnset,
    integerEnv('15000', { min: 1000, max: 60000 }),
  ),
  OPENAI_API_KEY: optional(z.string()),
  OPENAI_VLM_MODEL: optional(z.string()),
  /** Optional stronger model for re-reading a warning that looks wrong. */
  OPENAI_WARNING_MODEL: optional(z.string()),
  OPENAI_REASONING_EFFORT: optional(z.enum(['none', 'minimal', 'low', 'medium', 'high'])),
  AZURE_OPENAI_ENDPOINT: optional(z.string().url()),
  AZURE_OPENAI_API_KEY: optional(z.string()),
  AZURE_OPENAI_DEPLOYMENT: optional(z.string()),
  AZURE_OPENAI_API_VERSION: z.preprocess(blankAsUnset, z.string().default('2024-10-21')),
  LANGFUSE_PUBLIC_KEY: optional(z.string()),
  LANGFUSE_SECRET_KEY: optional(z.string()),
  LANGFUSE_HOST: optional(z.string().url()),
  DATABASE_URL: optional(z.string().url()),
});

function integerEnv(
  defaultValue: string,
  bounds: { min: number; max: number },
): z.ZodEffects<z.ZodDefault<z.ZodOptional<z.ZodString>>, number> {
  return z
    .string()
    .optional()
    .default(defaultValue)
    .transform((value, ctx) => {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected an integer between ${bounds.min} and ${bounds.max}`,
        });
        return z.NEVER;
      }
      const parsed = Number.parseInt(value, 10);
      if (parsed < bounds.min || parsed > bounds.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected an integer between ${bounds.min} and ${bounds.max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });
}

export type Env = z.infer<typeof baseSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = baseSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed:\n${issues}\n\nSee .env.example for the full contract.`,
    );
  }
  return result.data;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

// For tests only — reset the singleton between cases.
export function resetEnvForTesting(): void {
  cached = null;
}

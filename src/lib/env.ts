import { z } from 'zod';

/**
 * Environment-variable contract for the app.
 *
 * Required vars throw on first access. Optional vars (Langfuse) silently fall through
 * so the demo continues working when observability isn't configured.
 *
 * Azure OpenAI vars are conditionally required based on LABEL_EXTRACTOR.
 */

const baseSchema = z.object({
  LABEL_EXTRACTOR: z.enum(['openai', 'azure-openai']).default('openai'),
  OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  DEMO_PASSWORD: z.string().min(1, 'DEMO_PASSWORD is required'),
  DEMO_PASSWORD_COOKIE_SECRET: z
    .string()
    .min(16, 'DEMO_PASSWORD_COOKIE_SECRET must be at least 16 characters'),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
});

const envSchema = baseSchema.superRefine((data, ctx) => {
  if (data.LABEL_EXTRACTOR === 'openai' && !data.OPENAI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OPENAI_API_KEY'],
      message: 'OPENAI_API_KEY is required when LABEL_EXTRACTOR=openai',
    });
  }
  if (data.LABEL_EXTRACTOR === 'azure-openai') {
    if (!data.AZURE_OPENAI_ENDPOINT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_OPENAI_ENDPOINT'],
        message:
          'AZURE_OPENAI_ENDPOINT is required when LABEL_EXTRACTOR=azure-openai',
      });
    }
    if (!data.AZURE_OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AZURE_OPENAI_API_KEY'],
        message:
          'AZURE_OPENAI_API_KEY is required when LABEL_EXTRACTOR=azure-openai',
      });
    }
  }
});

export type Env = z.infer<typeof baseSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
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

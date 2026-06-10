import { getEnv } from '../env';
import { OpenAIExtractor } from './openai-extractor';
import { AzureOpenAIExtractor } from './azure-openai-extractor';
import { type LabelExtractor } from './types';

/**
 * Returns the configured LabelExtractor for the running environment.
 * Reads LABEL_EXTRACTOR; throws on unknown value.
 *
 * Verify routes and eval runners depend on this factory, not on the concrete
 * classes — the DIP boundary the rest of the codebase respects.
 */
export function getExtractor(): LabelExtractor {
  const env = getEnv();

  if (env.LABEL_EXTRACTOR === 'openai') {
    if (!env.OPENAI_API_KEY) {
      // Defense in depth — env validation already enforces this, but the type
      // is .optional() so TS needs reassurance.
      throw new Error('OPENAI_API_KEY missing despite LABEL_EXTRACTOR=openai');
    }
    return new OpenAIExtractor({ apiKey: env.OPENAI_API_KEY });
  }

  if (env.LABEL_EXTRACTOR === 'azure-openai') {
    if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY) {
      throw new Error(
        'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY required for azure-openai extractor',
      );
    }
    return new AzureOpenAIExtractor({
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiKey: env.AZURE_OPENAI_API_KEY,
      deployment: env.AZURE_OPENAI_DEPLOYMENT,
    });
  }

  // Exhaustiveness check — Zod enum constrains this, but TS keeps us honest.
  const _exhaustive: never = env.LABEL_EXTRACTOR;
  throw new Error(`Unknown LABEL_EXTRACTOR: ${_exhaustive}`);
}

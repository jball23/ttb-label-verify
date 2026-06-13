import { getEnv } from '../env';
import { OpenAIExtractor, OpenAIVlmFallback } from './openai-extractor';
import { AzureOpenAIExtractor } from './azure-openai-extractor';
import { TesseractExtractor } from './tesseract-extractor';
import { type DocumentExtractor } from './types';

/**
 * Returns the configured DocumentExtractor for the running environment.
 *
 * The default is the Tesseract-first extractor, with OpenAI VLM as the
 * per-field fallback when OPENAI_API_KEY is set. Setting LABEL_EXTRACTOR to
 * 'openai' or 'azure-openai' returns the legacy single-call extractor (kept
 * for comparison testing and fallback-disabled benchmarks).
 *
 * Verify routes and eval runners depend on this factory, not on the concrete
 * classes — the DIP boundary the rest of the codebase respects.
 */
export function getExtractor(): DocumentExtractor {
  const env = getEnv();

  if (env.LABEL_EXTRACTOR === 'openai') {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY missing despite LABEL_EXTRACTOR=openai');
    }
    return new OpenAIExtractor({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_VLM_MODEL,
    });
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

  if (env.LABEL_EXTRACTOR === 'tesseract') {
    const fallback = env.OPENAI_API_KEY
      ? new OpenAIVlmFallback({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_VLM_MODEL,
        })
      : undefined;
    return new TesseractExtractor({ vlmFallback: fallback });
  }

  // Exhaustiveness check — Zod enum constrains this, but TS keeps us honest.
  const _exhaustive: never = env.LABEL_EXTRACTOR;
  throw new Error(`Unknown LABEL_EXTRACTOR: ${_exhaustive}`);
}

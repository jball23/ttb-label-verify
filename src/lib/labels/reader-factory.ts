import OpenAI, { AzureOpenAI } from 'openai';
import { getEnv, type Env } from '../env';
import { getObservedOpenAI } from '../observability/langfuse';
import { ReaderAuthError } from './errors';
import { FakeLabelReader } from './fake-label-reader';
import { type LabelReader } from './label-reader';
import { OpenAICompatibleReader } from './openai-compatible-reader';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
/** Re-reads a warning that looks wrong; measured to fix small-type misreads without passing real errors. */
export const DEFAULT_WARNING_MODEL = 'gpt-5.4';

let cached: LabelReader | null = null;

/** The configured label reader, built once per server process. */
export function getLabelReader(): LabelReader {
  cached ??= createLabelReader(getEnv());
  return cached;
}

export function createLabelReader(env: Env): LabelReader {
  const shared = {
    timeoutMs: env.LABEL_READER_TIMEOUT_MS,
    reasoningEffort: env.OPENAI_REASONING_EFFORT,
  };
  switch (env.LABEL_READER) {
    case 'fake':
      return new FakeLabelReader();
    case 'azure-openai': {
      const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT } = env;
      if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY || !AZURE_OPENAI_DEPLOYMENT) {
        throw new ReaderAuthError(
          new Error('AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT are required'),
        );
      }
      const client: OpenAI = new AzureOpenAI({
        endpoint: AZURE_OPENAI_ENDPOINT,
        apiKey: AZURE_OPENAI_API_KEY,
        deployment: AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
      });
      return new OpenAICompatibleReader({
        ...shared,
        client,
        model: AZURE_OPENAI_DEPLOYMENT,
        provider: 'azure-openai',
      });
    }
    case 'openai': {
      if (!env.OPENAI_API_KEY) {
        throw new ReaderAuthError(new Error('OPENAI_API_KEY is required'));
      }
      return new OpenAICompatibleReader({
        ...shared,
        client: getObservedOpenAI(env.OPENAI_API_KEY),
        model: env.OPENAI_VLM_MODEL ?? DEFAULT_OPENAI_MODEL,
        warningModel: env.OPENAI_WARNING_MODEL ?? DEFAULT_WARNING_MODEL,
        provider: 'openai',
      });
    }
  }
}

export function resetLabelReaderForTesting(): void {
  cached = null;
}

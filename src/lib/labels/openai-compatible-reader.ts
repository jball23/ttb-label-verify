import type OpenAI from 'openai';
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { type ReasoningEffort } from 'openai/resources/shared';
import {
  LabelPipelineError,
  ReaderAuthError,
  ReaderRateLimitError,
  ReaderResponseError,
  ReaderTimeoutError,
} from './errors';
import { type LabelImage, type LabelReader } from './label-reader';
import { LABEL_READER_PROMPT } from './prompt';
import { retryRateLimitedRequest } from './rate-limit-retry';
import { LabelReadingSchema, normalizeReading, type LabelReading } from './reading';

export interface OpenAICompatibleReaderOptions {
  /** An `OpenAI` or `AzureOpenAI` client — both expose the same chat API. */
  client: OpenAI;
  /** Model name (OpenAI) or deployment name (Azure OpenAI). */
  model: string;
  provider: 'openai' | 'azure-openai';
  /** Hard ceiling per attempt. The product target is ~5 s end to end. */
  timeoutMs?: number;
  rateLimitRetries?: number;
  reasoningEffort?: ReasoningEffort;
}

const RESPONSE_FORMAT = zodResponseFormat(LabelReadingSchema, 'label_reading');

/**
 * One structured-output vision call per label. Works for OpenAI and Azure
 * OpenAI alike because both are driven through the same client surface.
 */
export class OpenAICompatibleReader implements LabelReader {
  readonly modelId: string;

  constructor(private readonly options: OpenAICompatibleReaderOptions) {
    this.modelId = `${options.provider}:${options.model}`;
  }

  async read(image: LabelImage): Promise<LabelReading> {
    const { client, model, timeoutMs = 15_000, rateLimitRetries = 2, reasoningEffort } =
      this.options;
    try {
      const completion = await retryRateLimitedRequest(
        () =>
          client.chat.completions.parse(
            {
              model,
              messages: [
                { role: 'system', content: LABEL_READER_PROMPT },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Read this alcohol beverage label.' },
                    {
                      type: 'image_url',
                      image_url: { url: toDataUrl(image), detail: 'high' },
                    },
                  ],
                },
              ],
              response_format: RESPONSE_FORMAT,
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            },
            { timeout: timeoutMs, maxRetries: 0 },
          ),
        { maxRetries: rateLimitRetries, baseDelayMs: 400, maxDelayMs: 2_000 },
      );
      const parsed = completion.choices[0]?.message.parsed;
      if (!parsed) throw new ReaderResponseError();
      return normalizeReading(parsed);
    } catch (error) {
      throw toPipelineError(error);
    }
  }
}

function toDataUrl(image: LabelImage): string {
  return `data:${image.mimeType};base64,${image.bytes.toString('base64')}`;
}

function toPipelineError(error: unknown): LabelPipelineError {
  if (error instanceof LabelPipelineError) return error;
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new ReaderAuthError(error);
  }
  if (error instanceof RateLimitError) return new ReaderRateLimitError(error);
  if (error instanceof APIConnectionTimeoutError) return new ReaderTimeoutError(error);
  return new ReaderResponseError(error);
}

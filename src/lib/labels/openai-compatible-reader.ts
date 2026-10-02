import type OpenAI from 'openai';
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { type ReasoningEffort } from 'openai/resources/shared';
import { z } from 'zod';
import {
  LabelPipelineError,
  ReaderAuthError,
  ReaderRateLimitError,
  ReaderResponseError,
  ReaderTimeoutError,
} from './errors';
import { type LabelImage, type LabelReader } from './label-reader';
import { LABEL_READER_PROMPT, WARNING_READER_PROMPT } from './prompt';
import { retryRateLimitedRequest } from './rate-limit-retry';
import { LabelReadingSchema, normalizeReading, type LabelReading } from './reading';

export interface OpenAICompatibleReaderOptions {
  /** An `OpenAI` or `AzureOpenAI` client — both expose the same chat API. */
  client: OpenAI;
  /** Model name (OpenAI) or deployment name (Azure OpenAI). */
  model: string;
  /** Model for the focused warning re-read; defaults to `model`. A stronger one helps with small type. */
  warningModel?: string;
  provider: 'openai' | 'azure-openai';
  /** Hard ceiling per attempt. The product target is ~5 s end to end. */
  timeoutMs?: number;
  rateLimitRetries?: number;
  reasoningEffort?: ReasoningEffort;
}

const LABEL_FORMAT = zodResponseFormat(LabelReadingSchema, 'label_reading');
const WARNING_FORMAT = zodResponseFormat(z.object({ verbatimText: z.string().nullable() }), 'warning_reading');

/**
 * Structured-output vision calls for OpenAI and Azure OpenAI alike, since
 * both are driven through the same client surface.
 */
export class OpenAICompatibleReader implements LabelReader {
  readonly modelId: string;

  constructor(private readonly options: OpenAICompatibleReaderOptions) {
    this.modelId = `${options.provider}:${options.model}`;
  }

  async read(image: LabelImage): Promise<LabelReading> {
    const reading = await this.ask(this.options.model, image, LABEL_READER_PROMPT, 'Read this alcohol beverage label.', LABEL_FORMAT);
    return normalizeReading(reading);
  }

  async readWarning(image: LabelImage): Promise<string | null> {
    const model = this.options.warningModel ?? this.options.model;
    const { verbatimText } = await this.ask(model, image, WARNING_READER_PROMPT, 'Transcribe the government warning.', WARNING_FORMAT);
    return verbatimText?.trim() ? verbatimText : null;
  }

  /** One image, one instruction, one parsed answer; every failure becomes a typed error. */
  private async ask<T>(
    model: string,
    image: LabelImage,
    system: string,
    instruction: string,
    format: ReturnType<typeof zodResponseFormat<z.ZodType<T>>>,
  ): Promise<T> {
    const { client, timeoutMs = 15_000, rateLimitRetries = 2, reasoningEffort } = this.options;
    try {
      const completion = await retryRateLimitedRequest(
        () =>
          client.chat.completions.parse(
            {
              model,
              messages: [
                { role: 'system', content: system },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: instruction },
                    { type: 'image_url', image_url: { url: toDataUrl(image), detail: 'high' } },
                  ],
                },
              ],
              response_format: format,
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            },
            { timeout: timeoutMs, maxRetries: 0 },
          ),
        { maxRetries: rateLimitRetries, baseDelayMs: 400, maxDelayMs: 2_000 },
      );
      const parsed = completion.choices[0]?.message.parsed;
      if (!parsed) throw new ReaderResponseError();
      return parsed as T;
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

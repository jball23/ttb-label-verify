import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  ExtractedDocumentSchema,
  type DocumentExtractor,
  type ExtractedDocument,
} from './types';
import { SYSTEM_PROMPT, USER_PROMPT_INTRO } from './prompt';
import { getObservedOpenAI } from '../observability/langfuse';

export interface OpenAIExtractorOptions {
  apiKey: string;
  model?: string;
  client?: OpenAI;
}

const DEFAULT_MODEL = 'gpt-4o-2024-11-20';

export class OpenAIExtractor implements DocumentExtractor {
  readonly providerName = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIExtractorOptions) {
    this.client = options.client ?? getObservedOpenAI(options.apiKey);
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async extract(pngBuffer: Buffer): Promise<ExtractedDocument> {
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: zodResponseFormat(ExtractedDocumentSchema, 'extracted_document'),
      // Deterministic settings — the same image+prompt should yield the same
      // extraction every run. temperature=0 + a fixed seed materially reduces
      // run-to-run drift in vision-LLM outputs.
      temperature: 0,
      seed: 1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT_INTRO },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      throw new Error(
        'OpenAI returned an empty response. Check API status or rate limits.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `OpenAI returned malformed JSON despite structured-output mode: ${(e as Error).message}`,
      );
    }

    return ExtractedDocumentSchema.parse(parsed);
  }
}

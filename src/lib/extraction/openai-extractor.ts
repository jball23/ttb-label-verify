import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  ExtractedFieldsSchema,
  type ExtractedFields,
  type LabelExtractor,
} from './types';
import { SYSTEM_PROMPT, USER_PROMPT_INTRO } from './prompt';

export interface OpenAIExtractorOptions {
  apiKey: string;
  model?: string;
  client?: OpenAI;
}

const DEFAULT_MODEL = 'gpt-4o-2024-11-20';

export class OpenAIExtractor implements LabelExtractor {
  readonly providerName = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIExtractorOptions) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async extract(image: Buffer, mimeType: string): Promise<ExtractedFields> {
    const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: zodResponseFormat(ExtractedFieldsSchema, 'extracted_fields'),
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

    return ExtractedFieldsSchema.parse(parsed);
  }
}

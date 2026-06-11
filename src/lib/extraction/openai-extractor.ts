import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  ExtractedDocumentSchema,
  ExtractedDocumentNoProvenanceSchema,
  type DocumentExtractor,
  type ExtractedDocument,
} from './types';
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_NO_PROVENANCE,
  USER_PROMPT_INTRO,
  USER_PROMPT_INTRO_NO_PROVENANCE,
} from './prompt';
import { getObservedOpenAI } from '../observability/langfuse';
import { getEnv } from '../env';

export interface OpenAIExtractorOptions {
  apiKey: string;
  model?: string;
  client?: OpenAI;
}

// gpt-4o (full) for extraction quality. Mini was tried but made more mistakes
// on the COLA form's filled-in cells. Override via OpenAIExtractorOptions
// when testing alternate models.
const DEFAULT_MODEL = 'gpt-4o-2024-11-20';

export class OpenAIExtractor implements DocumentExtractor {
  readonly providerName = 'openai';
  readonly modelId: string;
  private readonly client: OpenAI;

  constructor(options: OpenAIExtractorOptions) {
    this.client = options.client ?? getObservedOpenAI(options.apiKey);
    this.modelId = options.model ?? DEFAULT_MODEL;
  }

  async extract(pngBuffer: Buffer): Promise<ExtractedDocument> {
    const includeProvenance = getEnv().EXTRACT_PROVENANCE;
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    const responseFormat = includeProvenance
      ? zodResponseFormat(ExtractedDocumentSchema, 'extracted_document')
      : zodResponseFormat(
          ExtractedDocumentNoProvenanceSchema,
          'extracted_document_no_provenance',
        );

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      response_format: responseFormat,
      // Deterministic settings — the same image+prompt should yield the same
      // extraction every run. temperature=0 + a fixed seed materially reduces
      // run-to-run drift in vision-LLM outputs.
      temperature: 0,
      seed: 1,
      messages: [
        {
          role: 'system',
          content: includeProvenance ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_PROVENANCE,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: includeProvenance ? USER_PROMPT_INTRO : USER_PROMPT_INTRO_NO_PROVENANCE,
            },
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

    if (includeProvenance) {
      return ExtractedDocumentSchema.parse(parsed);
    }

    // Lean schema didn't ask for provenance — pad it so the in-memory shape
    // stays consistent. Caller (route handler) synthesizes app-side bboxes
    // deterministically and accepts empty label-side bboxes.
    const lean = ExtractedDocumentNoProvenanceSchema.parse(parsed);
    return { ...lean, provenance: {} };
  }
}

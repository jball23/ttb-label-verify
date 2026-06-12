import OpenAI from 'openai';
import { z } from 'zod';
import {
  ExtractedDocumentSchema,
  ExtractedDocumentNoProvenanceSchema,
  type DocumentExtractor,
  type ExtractedDocument,
  type FieldPath,
} from './types';
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_NO_PROVENANCE,
  USER_PROMPT_INTRO,
  USER_PROMPT_INTRO_NO_PROVENANCE,
  PROMPT_VERSION_TESSERACT_FALLBACK_V1,
} from './prompt';
import { type VlmSingleFieldExtractor } from './tesseract-extractor';
import { type RenderedPageKind } from '../pdf/render';
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

/**
 * Legacy OpenAI document extractor. Kept until U5's parity gate confirms
 * the Tesseract pipeline is on par. The factory routes to Tesseract by
 * default; this extractor is exposed only for direct test fixtures and
 * for the OpenAIVlmFallback companion below.
 */
export class OpenAIExtractor implements DocumentExtractor {
  readonly providerName = 'openai';
  readonly modelId: string;
  private readonly client: OpenAI;

  constructor(options: OpenAIExtractorOptions) {
    this.client = options.client ?? getObservedOpenAI(options.apiKey);
    this.modelId = options.model ?? DEFAULT_MODEL;
  }

  async extract(pages: { pageNumber: number; kind: string; png: Buffer }[]): Promise<ExtractedDocument> {
    if (pages.length === 0) {
      throw new Error(
        'OpenAIExtractor.extract requires at least one rendered page.',
      );
    }
    const pngBuffers = pages.map((p) => p.png);
    const includeProvenance = getEnv().EXTRACT_PROVENANCE;
    const imageContent = pngBuffers.map((png) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:image/png;base64,${png.toString('base64')}`,
        detail: 'high' as const,
      },
    }));

    const responseFormat = includeProvenance
      ? zodResponseFormatWrapper(ExtractedDocumentSchema, 'extracted_document')
      : zodResponseFormatWrapper(
          ExtractedDocumentNoProvenanceSchema,
          'extracted_document_no_provenance',
        );

    const introText = includeProvenance
      ? USER_PROMPT_INTRO
      : USER_PROMPT_INTRO_NO_PROVENANCE;
    const multiPageNote =
      pngBuffers.length > 1
        ? ` You are receiving ${pngBuffers.length} page images for this single application; treat them as one document. The form fields (Item 1-18) usually appear on one page, and the affixed label artwork (often a separate "front" and "back" label) may appear on another page. Extract each field from whichever page it actually appears on.`
        : '';

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      response_format: responseFormat,
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
            { type: 'text', text: introText + multiPageNote },
            ...imageContent,
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

    const lean = ExtractedDocumentNoProvenanceSchema.parse(parsed);
    return { ...lean, provenance: {} };
  }
}

// ---------------------------------------------------------------------------
// VLM fallback — single-field re-extraction (KD3).
// ---------------------------------------------------------------------------

const SingleFieldResponseSchema = z.object({
  value: z.string().nullable(),
});

/**
 * Per-field re-extraction over GPT-4o. Used by TesseractExtractor when
 * Tesseract returns no words or low confidence for a field (KD3). The
 * response is just `{ value: string | null }` — no bbox, no schema bloat.
 *
 * Prompt version: PROMPT_VERSION_TESSERACT_FALLBACK_V1 (preserves audit
 * trail continuity across the swap — see doc-review FYI on prompt version
 * naming).
 */
export class OpenAIVlmFallback implements VlmSingleFieldExtractor {
  private readonly client: OpenAI;
  readonly modelId: string;
  readonly promptVersion = PROMPT_VERSION_TESSERACT_FALLBACK_V1;

  constructor(options: OpenAIExtractorOptions) {
    this.client = options.client ?? getObservedOpenAI(options.apiKey);
    this.modelId = options.model ?? DEFAULT_MODEL;
  }

  async extractField(input: {
    fieldPath: FieldPath;
    pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  }): Promise<string | null> {
    const { fieldPath, pages } = input;
    const imageContent = pages.map((p) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:image/png;base64,${p.png.toString('base64')}`,
        detail: 'high' as const,
      },
    }));

    const fieldDescription = describeField(fieldPath);
    const response = await this.client.chat.completions.create({
      model: this.modelId,
      response_format: zodResponseFormatWrapper(SingleFieldResponseSchema, 'single_field'),
      temperature: 0,
      seed: 1,
      messages: [
        {
          role: 'system',
          content:
            'You are a TTB COLA reviewer reading one specific field from an application PDF. Return only that field\'s value or null if it does not appear.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Read the value of "${fieldDescription}" (${fieldPath}) from the supplied page images. Return JSON: { "value": "<verbatim text>" } or { "value": null } if you cannot find it.`,
            },
            ...imageContent,
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;
    try {
      const parsed = SingleFieldResponseSchema.parse(JSON.parse(raw));
      return parsed.value && parsed.value.trim().length > 0 ? parsed.value.trim() : null;
    } catch {
      return null;
    }
  }
}

function describeField(fieldPath: FieldPath): string {
  // Human-readable label for the prompt — uses the printed TTB form item
  // names where applicable.
  const map: Record<string, string> = {
    'application.brandName': 'Brand Name (Item 6)',
    'application.fancifulName': 'Fanciful Name (Item 7)',
    'application.applicant.name': 'Name and Address of Applicant (Item 8a)',
    'application.mailingAddress': 'Mailing Address (Item 8)',
    'application.formula': 'Formula (Item 15)',
    'application.serialNumber': 'Serial Number (Item 4)',
    'application.plantRegistryNumber': 'Plant Registry Number (Item 2)',
    'application.productType': 'Type of Product (Item 5)',
    'application.email': 'E-Mail Address (Item 9)',
    'application.phone': 'Telephone Number (Item 10)',
    'application.applicationType': 'Type of Application (Item 11)',
    'application.wineAppellation': 'Wine Appellation (Item 13)',
    'application.grapeVarietals': 'Grape Varietal (Item 14)',
    'application.applicationDate': 'Date of Application (Item 18)',
    'label.brandName': 'Brand Name printed on the affixed label',
    'label.abv': 'Alcohol by Volume (e.g. "12.6% ALC/VOL")',
    'label.governmentWarning': 'The Government Warning statement verbatim',
    'label.netContents': 'Net Contents (e.g. "750 mL", "1.5 L", "12 fl oz")',
    'label.classType': 'Class/Type designation (e.g. "STRAIGHT BOURBON WHISKEY")',
    'label.producer': 'Producer attribution (e.g. "Produced by ...", "Imported by ...")',
    'label.countryOfOrigin': 'Country of Origin (e.g. "Product of France")',
    'label.wineVarietal': 'Wine varietal printed on the label',
    'label.wineAppellation': 'Wine appellation printed on the label',
  };
  return map[fieldPath] ?? fieldPath;
}

// ---------------------------------------------------------------------------
// Local wrapper around openai/helpers/zod to satisfy the OpenAI SDK's
// expected ResponseFormat shape from our local Zod schemas.
// ---------------------------------------------------------------------------

import { zodResponseFormat } from 'openai/helpers/zod';

function zodResponseFormatWrapper<T extends z.ZodTypeAny>(
  schema: T,
  name: string,
): ReturnType<typeof zodResponseFormat> {
  return zodResponseFormat(schema, name);
}

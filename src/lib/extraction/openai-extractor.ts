import OpenAI from 'openai';
import { z } from 'zod';
import {
  ExtractedDocumentSchema,
  ExtractedDocumentNoProvenanceSchema,
  type DocumentExtractor,
  type ExtractedDocument,
  type ExtractorOptions,
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
import { runOpenAIRequest } from './openai-throttle';

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

  async extract(
    pages: { pageNumber: number; kind: string; png: Buffer }[],
    _options?: ExtractorOptions,
  ): Promise<ExtractedDocument> {
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

    const response = await runOpenAIRequest(() =>
      this.client.chat.completions.create({
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
      }),
    );

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
// VLM fallback — single-field re-extraction.
// ---------------------------------------------------------------------------

const SingleFieldResponseSchema = z.object({
  value: z.string().nullable(),
});

/**
 * Per-field re-extraction over the configured OpenAI vision model. Used by
 * TesseractExtractor when Tesseract returns no words or low confidence. The
 * response is just `{ value: string | null }` — no bbox, no schema bloat.
 *
 * Prompt version: PROMPT_VERSION_TESSERACT_FALLBACK_V1 (preserves audit
 * trail continuity across extractor revisions).
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
    const fieldInstruction = describeFieldInstruction(fieldPath);
    const response = await runOpenAIRequest(() =>
      this.client.chat.completions.create({
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
                text: `Read the value of "${fieldDescription}" (${fieldPath}) from the supplied page images. ${fieldInstruction} Return JSON: { "value": "<verbatim text>" } or { "value": null } if you cannot find it.`,
              },
              ...imageContent,
            ],
          },
        ],
      }),
    );

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
    'application.applicant.name': 'Name and Address of Applicant (Item 8); prefer the approved DBA/tradename marked "Used on label" when present',
    'application.mailingAddress': 'Mailing Address, if different (Item 8a)',
    'application.formula': 'Formula (Item 9)',
    'application.serialNumber': 'Serial Number (Item 4)',
    'application.plantRegistryNumber': 'Plant Registry Number (Item 2)',
    'application.source': 'Source of Product (Item 3), Domestic or Imported',
    'application.productType': 'Type of Product (Item 5)',
    'application.grapeVarietals': 'Grape Varietal(s), wine only (Item 10)',
    'application.wineAppellation': 'Wine Appellation, if on label (Item 11)',
    'application.phone': 'Telephone Number (Item 12)',
    'application.email': 'E-Mail Address (Item 13)',
    'application.applicationType': 'Type of Application (Item 14)',
    'application.applicationDate': 'Date of Application (Item 16)',
    'label.brandName': 'Brand Name printed on the affixed label',
    'label.abv': 'Alcohol by Volume (e.g. "12.6% ALC/VOL")',
    'label.governmentWarning': 'The complete Government Warning statement verbatim',
    'label.netContents': 'Net Contents (e.g. "750 mL", "1.5 L", "12 fl oz")',
    'label.classType': 'Fanciful/product name or class/type designation printed prominently on the label (e.g. "Debutante", "STRAIGHT BOURBON WHISKEY")',
    'label.producer': 'Producer attribution (e.g. "Produced by ...", "Imported by ...")',
    'label.countryOfOrigin': 'Country of Origin (e.g. "Product of France")',
    'label.wineVarietal': 'Wine varietal printed on the label',
    'label.wineAppellation': 'Wine appellation printed on the label',
  };
  return map[fieldPath] ?? fieldPath;
}

function describeFieldInstruction(fieldPath: FieldPath): string {
  if (fieldPath === 'label.governmentWarning') {
    return 'For the Government Warning, include the "GOVERNMENT WARNING:" prefix when visible and return both numbered sentences in full. Do not return only sentence (1) or only sentence (2).';
  }
  if (fieldPath === 'label.wineVarietal') {
    return 'Return only true grape varietals such as Cabernet Sauvignon, Chardonnay, Merlot, etc. Return null for "red wine blend", "white wine blend", "wine blend", appellations, fanciful names, or class/type text.';
  }
  if (fieldPath === 'label.wineAppellation') {
    return 'Return only an appellation/geographic designation such as American, California, Napa Valley, etc. Return null for N/A, grape varietals, or class/type text.';
  }
  if (fieldPath === 'label.countryOfOrigin') {
    return 'Return a country of origin only when the label explicitly says Product of/Country of Origin/Made in a country. Do not use wine appellations or class/type phrases such as American White Wine; return null for those.';
  }
  return '';
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

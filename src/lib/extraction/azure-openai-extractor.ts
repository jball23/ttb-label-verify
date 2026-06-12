import {
  type DocumentExtractor,
  type ExtractedDocument,
  NotImplementedError,
} from './types';

export interface AzureOpenAIExtractorOptions {
  endpoint: string;
  apiKey: string;
  deployment?: string;
}

/**
 * Documented production swap path.
 *
 * In the FedRAMP-bounded production deployment, this would call an Azure OpenAI
 * deployment (gpt-4o or equivalent vision-capable model) using the same `openai`
 * SDK with a `baseURL` pointed at the Azure endpoint and `api-key` header.
 *
 * The prompt template, JSON schema, and Zod parse logic are reusable verbatim from
 * `openai-extractor.ts` — only the client construction differs. We deliberately
 * throw `NotImplementedError` here (Liskov-safe) rather than returning mock data,
 * so misconfiguration surfaces loudly rather than silently producing fake results.
 */
export class AzureOpenAIExtractor implements DocumentExtractor {
  readonly providerName = 'azure-openai';
  readonly modelId: string;

  constructor(private readonly options: AzureOpenAIExtractorOptions) {
    this.modelId = `azure:${options.deployment ?? 'unknown'}`;
  }

  async extract(_pages: { pageNumber: number; kind: string; png: Buffer }[]): Promise<ExtractedDocument> {
    throw new NotImplementedError(
      `AzureOpenAIExtractor is documented but not implemented in the prototype. ` +
        `Endpoint configured: ${this.options.endpoint}. ` +
        `See README "Azure OpenAI migration path" for the production swap.`,
    );
  }
}

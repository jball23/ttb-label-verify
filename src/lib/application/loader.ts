import { z } from 'zod';
import { ApplicationSchema } from './types';
import type {
  Application,
  ApplicationForm,
  ApplicationProductType,
} from './types';
import type { ExtractedApplicationForm } from '../extraction/types';
import {
  normalizeWineAppellationClaim,
  normalizeWineVarietalClaim,
} from '../cross-check/normalize';

/**
 * Thrown when an application payload fails Zod validation. Carries the formatted
 * Zod error message so the verify route can surface a useful 400 to the client
 * without leaking schema internals.
 */
export class InvalidApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApplicationError';
  }
}

/**
 * Parse and validate an unknown payload as a COLA Application.
 *
 * The verify route calls this on the `application` multipart form field after
 * JSON-decoding. The demo scenario picker (client-side) calls it after fetching
 * `/samples/applications/0N-*` so a corrupted fixture fails before populating
 * the upload state.
 */
export function parseApplication(input: unknown): Application {
  const result = ApplicationSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidApplicationError(formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    lines.push(path + ': ' + issue.message);
  }
  return 'Application JSON failed validation:\n' + lines.join('\n');
}

const FALLBACK_STRING = '';

function strOrFallback(value: string | null | undefined): string {
  return value ?? FALLBACK_STRING;
}

/**
 * Build the full Application shape from the bare form fields the dual extractor
 * returns. Downstream (cross-check, rules engine) was designed against the
 * canonical Application — this is the bridge that lets the new PDF-only flow
 * reuse it unchanged.
 *
 * Synthesis rules:
 *  - crossCheckExpectations.classType prefers fancifulName (which holds the
 *    commercial class designation, e.g. "Kentucky Straight Bourbon Whiskey")
 *    and falls back to productType when fanciful is missing.
 *  - producer is "<applicant name>, <city>, <state>" — the same shape the
 *    canonical scenario fixtures encode.
 *  - countryOfOrigin derives from source: Domestic → "USA".
 *  - Wine fields only populate when productType === "WINE".
 *  - labelOnlyExpectations are regulatory constants the engine doesn't read;
 *    we still emit a well-formed block so the Application Zod parse passes.
 */
export function synthesizeExpectations(
  form: ExtractedApplicationForm,
): Application {
  const productType: ApplicationProductType =
    form.productType ??
    (form.grapeVarietals || form.wineAppellation ? 'WINE' : 'DISTILLED SPIRITS');
  const isWine = productType === 'WINE';

  // classType in the cross-check carries the SPECIFIC class designation,
  // which lives in Item 7 (Fanciful Name). Item 5 is the regulatory
  // category — too coarse to compare against a label that says e.g.
  // "TEQUILA" or "STRAIGHT BOURBON WHISKEY". When Item 7 is blank, leave
  // the expectation as empty string; the cross-check engine treats empty
  // application values as "not declared" and routes to `not_on_application`
  // (informational, not a mismatch).
  const fancifulTrimmed = form.fancifulName?.trim();
  const classType = fancifulTrimmed ? fancifulTrimmed : '';

  const producerParts = [
    form.applicant.name,
    form.applicant.city,
    form.applicant.state,
  ]
    .filter((p): p is string => p != null && p.length > 0)
    .join(', ');

  const countryOfOrigin =
    form.source === 'Imported'
      ? 'IMPORTED'
      : form.source === 'Domestic'
        ? 'USA'
      : '';
  const wineVarietalExpectation = normalizeWineVarietalClaim(form.grapeVarietals);
  const wineAppellationExpectation = normalizeWineAppellationClaim(
    form.wineAppellation,
  );

  const synthesizedForm: ApplicationForm = {
    repId: null,
    plantRegistryNumber: strOrFallback(form.plantRegistryNumber),
    source: form.source ?? 'Domestic',
    serialNumber: strOrFallback(form.serialNumber),
    productType,
    brandName: strOrFallback(form.brandName),
    fancifulName: form.fancifulName,
    applicant: {
      name: strOrFallback(form.applicant.name),
      addressLine1: strOrFallback(form.applicant.addressLine1),
      city: strOrFallback(form.applicant.city),
      state: strOrFallback(form.applicant.state),
      postalCode: strOrFallback(form.applicant.postalCode),
    },
    mailingAddress: null,
    formulaId: null,
    grapeVarietals: isWine ? form.grapeVarietals : null,
    wineAppellation: isWine ? form.wineAppellation : null,
    phone: '',
    email: '',
    applicationType: 'CERTIFICATE_OF_LABEL_APPROVAL',
    containerInfo: null,
    applicationDate: strOrFallback(form.applicationDate),
    applicantSignatureName: strOrFallback(form.applicantSignatureName),
  };

  const application: Application = {
    ttbFormId: 'TTB F 5100.31',
    formRevision: '04/2023',
    scenarioId: 'extracted',
    expectedVerdict: 'NEEDS_REVIEW',
    form: synthesizedForm,
    crossCheckExpectations: {
      brandName: strOrFallback(form.brandName),
      classType,
      producer: producerParts,
      countryOfOrigin,
      ...(isWine && wineVarietalExpectation
        ? { wineVarietal: wineVarietalExpectation }
        : {}),
      ...(isWine && wineAppellationExpectation
        ? { wineAppellation: wineAppellationExpectation }
        : {}),
    },
    labelOnlyExpectations: {
      abv: '',
      netContents: '',
      governmentWarning: 'PRESENT_AND_VERBATIM',
    },
  };

  return application;
}

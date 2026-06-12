/**
 * Tesseract-first extractor with per-field GPT-4o fallback (U4).
 *
 * Pipeline:
 *   1. OCR every rendered page (`src/lib/ocr/worker.ts`) — single full-page
 *      pass per page (KD1), sequential across pages (KD7).
 *   2. Form half — for each FORM_LANDMARK, locate the printed marker text
 *      on the form page and collect the value words in the indicated
 *      direction (landmark-based assignment, more robust than hand-tuned
 *      pixel rects).
 *   3. Label half — full-page OCR text + LABEL_PATTERNS regex match for
 *      ABV, net contents, producer, country. Government Warning uses a
 *      fuzzy line-by-line match against `GOVERNMENT_WARNING_CANONICAL`
 *      tokens so OCR misreads (IMPARS→IMPAIRS, T50→750) still match.
 *   4. Fallback — for any field where the assigner produced no words or
 *      meanConfidence < OCR_CONFIDENCE_THRESHOLD, make a single VLM call
 *      for that one field. Returns text only; bbox flagged unavailable.
 *
 * Plan unit: U4. KDs: KD1, KD2, KD3, KD4, KD6.
 *
 * Note: this module replaces the GPT-4o provenance code path on the
 * Tesseract side, but the legacy openai-extractor stays as the VLM
 * fallback caller. Factory routing flips in U4 step 3.
 */
import { runOcr, type WordRect } from '../ocr/worker';
import { FORM_LANDMARKS, LABEL_PATTERNS, OCR_CONFIDENCE_THRESHOLD } from '../ocr/config';
import {
  type DocumentExtractor,
  type ExtractedDocument,
  type ExtractedApplicationForm,
  type ExtractedFields,
  type FieldBbox,
  type FieldBboxes,
  type FieldPath,
} from './types';
import { type RenderedPage, type RenderedPageKind } from '../pdf/render';
import {
  GOVERNMENT_WARNING_CANONICAL,
  normalizeWhitespace,
} from '../validation/ttb-constants';

const DEFAULT_MODEL = 'tesseract-eng-v6';

interface PageOcr {
  pageNumber: number;
  kind: RenderedPageKind;
  words: WordRect[];
  meanConfidence: number;
}

export interface TesseractExtractorOptions {
  /** Optional VLM fallback. When omitted, low-confidence fields are left blank. */
  vlmFallback?: VlmSingleFieldExtractor;
}

/** Single-field VLM fallback signature (KD3). */
export interface VlmSingleFieldExtractor {
  extractField(input: {
    fieldPath: FieldPath;
    pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  }): Promise<string | null>;
}

export class TesseractExtractor implements DocumentExtractor {
  readonly providerName = 'tesseract';
  readonly modelId: string;
  private readonly fallback?: VlmSingleFieldExtractor;

  constructor(options: TesseractExtractorOptions = {}) {
    this.modelId = DEFAULT_MODEL;
    this.fallback = options.vlmFallback;
  }

  /**
   * Legacy `DocumentExtractor` signature — used until U4 step 3 broadens the
   * interface. Without page kinds, we assume page 1 is form and any other
   * pages are label-back (matches the single-page synthetic-fixture path).
   */
  async extract(pngBuffers: Buffer[]): Promise<ExtractedDocument> {
    const pages: RenderedPage[] = pngBuffers.map((png, i) => ({
      pageNumber: i + 1,
      kind: i === 0 && pngBuffers.length === 1 ? 'form+label-front' : i === 0 ? 'form' : 'label-back',
      png,
    }));
    return this.extractFromPages(pages);
  }

  /**
   * Preferred entry point — takes pages with their classifier-emitted kinds
   * so the assigners route to the right page set.
   */
  async extractFromPages(pages: RenderedPage[]): Promise<ExtractedDocument> {
    if (pages.length === 0) {
      throw new Error('TesseractExtractor.extractFromPages requires at least one page.');
    }

    // 1. OCR every page sequentially (single cached worker, KD7).
    const pageOcr: PageOcr[] = [];
    for (const page of pages) {
      const result = await runOcr(page.png);
      pageOcr.push({
        pageNumber: page.pageNumber,
        kind: page.kind,
        words: result.words,
        meanConfidence: result.meanConfidence,
      });
    }

    // 2. Form assignment.
    const formPage = pageOcr.find((p) => p.kind === 'form' || p.kind.startsWith('form+'));
    const application = formPage
      ? assignFormFields(formPage)
      : blankApplication();
    const formBboxes = formPage ? collectFormBboxes(formPage, application) : {};

    // 3. Label assignment.
    const labelPages = pageOcr.filter((p) => p.kind.includes('label'));
    const { label, labelBboxes } = assignLabelFields(labelPages);

    let bboxes: FieldBboxes = { ...formBboxes, ...labelBboxes };

    // 4. Fallback pass for low-confidence / missing fields. Skip silently
    //    when no fallback is wired.
    if (this.fallback) {
      const fallbackPages = pages.map((p) => ({
        pageNumber: p.pageNumber,
        png: p.png,
        kind: p.kind,
      }));
      bboxes = await runFallback({
        application,
        label,
        bboxes,
        pages: fallbackPages,
        fallback: this.fallback,
      });
    }

    return {
      application,
      label,
      provenance: {}, // Legacy field; populated as empty until U4 step 3 removes it.
      bboxes,
    };
  }
}

// ---------------------------------------------------------------------------
// Form-side assigner (landmark-based)
// ---------------------------------------------------------------------------

function assignFormFields(page: PageOcr): ExtractedApplicationForm {
  const result = blankApplication();
  for (const landmark of FORM_LANDMARKS) {
    const value = readValueAtLandmark(page.words, landmark.marker, landmark.valueDirection);
    if (value === null) continue;
    setApplicationField(result, landmark.field, value);
  }
  return result;
}

/**
 * Find the landmark words on the page and collect value text in the
 * indicated direction. `right` returns words on the same line, to the
 * right of the landmark. `below` returns the next non-empty line below
 * the landmark.
 */
function readValueAtLandmark(
  words: WordRect[],
  marker: string,
  direction: 'right' | 'below',
  maxDistancePx = 250,
): string | null {
  const markerTokens = marker
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  if (markerTokens.length === 0) return null;

  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  // Walk in reading order; find a contiguous run matching markerTokens.
  for (let i = 0; i <= sorted.length - markerTokens.length; i++) {
    if (!matchesRun(sorted, i, markerTokens)) continue;
    const lastIndex = i + markerTokens.length - 1;
    const startWord = sorted[i]!;
    const endWord = sorted[lastIndex]!;

    if (direction === 'right') {
      const valueWords = sorted.filter(
        (w) =>
          Math.abs(w.bbox.y0 - startWord.bbox.y0) < 18 &&
          w.bbox.x0 > endWord.bbox.x1 &&
          w.bbox.x0 - endWord.bbox.x1 < maxDistancePx,
      );
      if (valueWords.length === 0) continue;
      return valueWords.map((w) => w.text).join(' ').trim();
    }
    // direction === 'below'
    const lineHeight = endWord.bbox.y1 - endWord.bbox.y0;
    const valueWords = sorted.filter(
      (w) =>
        w.bbox.y0 > endWord.bbox.y1 &&
        w.bbox.y0 - endWord.bbox.y1 < Math.max(lineHeight * 2, 50) &&
        w.bbox.x0 < endWord.bbox.x1 + maxDistancePx &&
        w.bbox.x0 > startWord.bbox.x0 - 80,
    );
    if (valueWords.length === 0) continue;
    // Restrict to the first line below.
    const firstY = Math.min(...valueWords.map((w) => w.bbox.y0));
    const firstLine = valueWords.filter((w) => Math.abs(w.bbox.y0 - firstY) < 18);
    return firstLine.map((w) => w.text).join(' ').trim();
  }
  return null;
}

function matchesRun(words: WordRect[], start: number, tokens: string[]): boolean {
  for (let k = 0; k < tokens.length; k++) {
    const wordText = words[start + k]?.text.toLowerCase().replace(/[:.,]+$/, '') ?? '';
    if (!wordText.includes(tokens[k]!)) return false;
  }
  return true;
}

function collectFormBboxes(page: PageOcr, application: ExtractedApplicationForm): FieldBboxes {
  const bboxes: FieldBboxes = {};
  for (const landmark of FORM_LANDMARKS) {
    const value = getApplicationField(application, landmark.field);
    if (!value || value.trim().length === 0) continue;
    const words = findWordsInPage(page.words, value);
    if (words.length === 0) continue;
    const meanConfidence = Math.round(
      words.reduce((a, w) => a + w.confidence, 0) / words.length,
    );
    bboxes[landmark.field] = {
      page: page.pageNumber,
      source: 'tesseract',
      words,
      meanConfidence,
    } satisfies FieldBbox;
  }
  return bboxes;
}

function findWordsInPage(words: WordRect[], value: string): WordRect[] {
  const valueTokens = value
    .split(/\s+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/gi, ''))
    .filter((t) => t.length > 0);
  return words.filter((w) => {
    const cleanText = w.text.toLowerCase().replace(/[^a-z0-9]/gi, '');
    return valueTokens.some((vt) => vt.length > 0 && cleanText.includes(vt));
  });
}

// ---------------------------------------------------------------------------
// Label-side assigner (pattern + GW fuzzy match)
// ---------------------------------------------------------------------------

function assignLabelFields(pages: PageOcr[]): {
  label: ExtractedFields;
  labelBboxes: FieldBboxes;
} {
  const label: ExtractedFields = blankLabel();
  const labelBboxes: FieldBboxes = {};

  if (pages.length === 0) return { label, labelBboxes };

  // Search every label page; the back page is most likely to carry the
  // verdict-driving text, but we don't gate by tag — every artwork page is
  // a candidate.
  for (const page of pages) {
    const fullText = page.words.map((w) => w.text).join(' ');

    // Brand name — first non-trivial line that isn't an obvious header.
    if (!label.brandName) {
      const firstStrong = page.words.find(
        (w) => w.text.length >= 3 && w.confidence > 70 && !/^image|type/i.test(w.text),
      );
      if (firstStrong && page.kind.includes('front')) {
        label.brandName = firstStrong.text;
        labelBboxes['label.brandName'] = {
          page: page.pageNumber,
          source: 'tesseract',
          words: [firstStrong],
          meanConfidence: firstStrong.confidence,
        };
      }
    }

    // Pattern matches.
    for (const { field, pattern } of LABEL_PATTERNS) {
      const existing = labelBboxes[field];
      if (existing && existing.source === 'tesseract' && existing.words.length > 0) continue;
      const match = pattern.exec(fullText);
      if (!match) continue;
      const matchWords = collectMatchWords(page.words, match[0]);
      if (matchWords.length === 0) continue;
      const meanConfidence = Math.round(
        matchWords.reduce((a, w) => a + w.confidence, 0) / matchWords.length,
      );
      const fieldKey = stripLabelPrefix(field);
      // Assign to the ExtractedFields shape:
      assignLabelFieldValue(label, fieldKey, match[0]);
      labelBboxes[field] = {
        page: page.pageNumber,
        source: 'tesseract',
        words: matchWords,
        meanConfidence,
      };
    }

    // Government Warning — fuzzy multi-line match against the canonical.
    if (!label.governmentWarning.text) {
      const gwMatch = findGovernmentWarning(page);
      if (gwMatch) {
        label.governmentWarning = {
          text: gwMatch.text,
          appearsAllCaps: /^[^a-z]*$/.test(gwMatch.text),
          appearsBold: null, // Tesseract doesn't expose font weight reliably.
        };
        labelBboxes['label.governmentWarning'] = {
          page: page.pageNumber,
          source: 'tesseract',
          words: gwMatch.words,
          meanConfidence: gwMatch.meanConfidence,
        };
      }
    }
  }

  return { label, labelBboxes };
}

function findGovernmentWarning(page: PageOcr): {
  text: string;
  words: WordRect[];
  meanConfidence: number;
} | null {
  // Find the GOVERNMENT WARNING prefix; the canonical extends ~80 words
  // after it on real labels. We collect words on the same and following
  // lines until we hit a token outside the canonical token set.
  const prefixIdx = page.words.findIndex(
    (w, i) =>
      /^government$/i.test(w.text) &&
      /^warning/i.test(page.words[i + 1]?.text ?? ''),
  );
  if (prefixIdx === -1) return null;

  // Canonical token set for cheap-but-effective fuzzy match. OCR misreads
  // (IMPARS, ABLITY) still land in the canonical's word set if we match
  // word-prefix or word-suffix.
  const canonicalTokens = new Set(
    normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL)
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );

  const collected: WordRect[] = [];
  // The GW canonical is ~80 words; allow some slack.
  const window = page.words.slice(prefixIdx, prefixIdx + 130);
  for (const w of window) {
    const norm = w.text.toLowerCase().replace(/[^a-z]/g, '');
    if (norm.length === 0) continue;
    // Accept the word if any 4-char prefix appears in a canonical token,
    // OR vice versa — handles OCR drops like "IMPARS" vs "IMPAIRS".
    const matchesCanonical =
      canonicalTokens.has(norm) ||
      Array.from(canonicalTokens).some(
        (ct) => ct.length >= 4 && norm.length >= 4 && (
          ct.startsWith(norm.slice(0, 4)) || norm.startsWith(ct.slice(0, 4))
        ),
      );
    if (matchesCanonical) collected.push(w);
  }
  if (collected.length < 10) return null;

  const text = collected.map((w) => w.text).join(' ').trim();
  const meanConfidence = Math.round(
    collected.reduce((a, w) => a + w.confidence, 0) / collected.length,
  );
  return { text, words: collected, meanConfidence };
}

function collectMatchWords(words: WordRect[], match: string): WordRect[] {
  const matchTokens = match
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.]/g, ''))
    .filter((t) => t.length > 0);
  return words.filter((w) => {
    const clean = w.text.toLowerCase().replace(/[^a-z0-9.]/g, '');
    return matchTokens.some((mt) => clean.includes(mt));
  });
}

function stripLabelPrefix(field: FieldPath): keyof ExtractedFields | 'governmentWarning' {
  // label.brandName → brandName, label.governmentWarning → governmentWarning
  return field.replace(/^label\./, '') as keyof ExtractedFields | 'governmentWarning';
}

function assignLabelFieldValue(
  label: ExtractedFields,
  key: keyof ExtractedFields | 'governmentWarning',
  value: string,
): void {
  if (key === 'governmentWarning') return; // handled separately
  // The other label fields are all string-nullable.
  (label as Record<string, unknown>)[key] = value;
}

// ---------------------------------------------------------------------------
// Fallback (VLM single-field re-extraction)
// ---------------------------------------------------------------------------

async function runFallback(args: {
  application: ExtractedApplicationForm;
  label: ExtractedFields;
  bboxes: FieldBboxes;
  pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  fallback: VlmSingleFieldExtractor;
}): Promise<FieldBboxes> {
  const { application, label, bboxes, pages, fallback } = args;
  const updated: FieldBboxes = { ...bboxes };

  const targets: FieldPath[] = [];
  for (const landmark of FORM_LANDMARKS) {
    const existing = bboxes[landmark.field];
    const value = getApplicationField(application, landmark.field);
    if (shouldFallback(existing, value)) targets.push(landmark.field);
  }
  for (const { field } of LABEL_PATTERNS) {
    const existing = bboxes[field];
    const labelKey = stripLabelPrefix(field) as keyof ExtractedFields;
    const value =
      labelKey === 'governmentWarning'
        ? label.governmentWarning.text
        : (label[labelKey] as string | null);
    if (shouldFallback(existing, value)) targets.push(field);
  }
  if (!bboxes['label.governmentWarning'] && !label.governmentWarning.text) {
    targets.push('label.governmentWarning');
  }

  for (const fieldPath of targets) {
    const value = await fallback.extractField({ fieldPath, pages });
    if (value !== null) {
      applyFallbackValue(application, label, fieldPath, value);
    }
    updated[fieldPath] = {
      page: pages[0]?.pageNumber ?? 1,
      source: 'vlm',
      words: [],
      meanConfidence: null,
    } satisfies FieldBbox;
  }
  return updated;
}

function shouldFallback(existing: FieldBbox | undefined, value: string | null): boolean {
  if (existing?.source === 'vlm') return false;
  if (!value || value.trim().length === 0) return true;
  if (!existing) return true;
  if (existing.meanConfidence !== null && existing.meanConfidence < OCR_CONFIDENCE_THRESHOLD) return true;
  return false;
}

function applyFallbackValue(
  application: ExtractedApplicationForm,
  label: ExtractedFields,
  fieldPath: FieldPath,
  value: string,
): void {
  if (fieldPath.startsWith('application.')) {
    setApplicationField(application, fieldPath, value);
    return;
  }
  const labelKey = stripLabelPrefix(fieldPath);
  if (labelKey === 'governmentWarning') {
    label.governmentWarning.text = value;
    return;
  }
  (label as Record<string, unknown>)[labelKey] = value;
}

// ---------------------------------------------------------------------------
// Application field plumbing
// ---------------------------------------------------------------------------

function blankApplication(): ExtractedApplicationForm {
  return {
    repId: null,
    plantRegistryNumber: null,
    source: null,
    serialNumber: null,
    productType: null,
    brandName: null,
    fancifulName: null,
    applicant: { name: null, addressLine1: null, city: null, state: null, postalCode: null },
    mailingAddress: null,
    formula: null,
    grapeVarietals: null,
    wineAppellation: null,
    phone: null,
    email: null,
    applicationType: null,
    containerWording: null,
    applicationDate: null,
    applicantSignatureName: null,
  };
}

function blankLabel(): ExtractedFields {
  return {
    brandName: null,
    abv: null,
    governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
    netContents: null,
    classType: null,
    producer: null,
    countryOfOrigin: null,
    wineVarietal: null,
    wineAppellation: null,
    extractionConfidence: 'medium',
  };
}

function setApplicationField(
  application: ExtractedApplicationForm,
  fieldPath: FieldPath,
  value: string,
): void {
  if (!fieldPath.startsWith('application.')) return;
  const key = fieldPath.replace(/^application\./, '');
  if (key === 'applicant.name') {
    application.applicant.name = value;
    return;
  }
  if (key === 'applicant.address') {
    application.applicant.addressLine1 = value;
    return;
  }
  if (key === 'productType') {
    const upper = value.toUpperCase();
    if (upper === 'WINE' || upper === 'DISTILLED SPIRITS' || upper === 'MALT BEVERAGES') {
      application.productType = upper;
    }
    return;
  }
  if (key === 'source') {
    if (value.toLowerCase().startsWith('imp')) application.source = 'Imported';
    else application.source = 'Domestic';
    return;
  }
  if (key in application) {
    (application as Record<string, unknown>)[key] = value;
  }
}

function getApplicationField(
  application: ExtractedApplicationForm,
  fieldPath: FieldPath,
): string | null {
  if (!fieldPath.startsWith('application.')) return null;
  const key = fieldPath.replace(/^application\./, '');
  if (key === 'applicant.name') return application.applicant.name;
  if (key === 'applicant.address') return application.applicant.addressLine1;
  return (application as Record<string, unknown>)[key] as string | null;
}

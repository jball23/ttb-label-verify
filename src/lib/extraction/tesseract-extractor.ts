/**
 * Tesseract-first extractor with per-field OpenAI VLM fallback.
 *
 * The public `extract()` path runs form OCR and label OCR in the same sync
 * verification pass, so `/api/verify` can return a complete COLA report:
 * label rules, application-vs-label cross-check, and bboxes for both sides.
 *
 * Pipeline (sync path):
 *   1. Parallel OCR on every rendered page (`runOcr` via pool — Promise.all).
 *   2. Form assignment — landmark-based extraction against the selected
 *      form page, with exact value-word bboxes.
 *   3. Label assignment — LABEL_PATTERNS for ABV / net contents / producer
 *      / country + class type; GW canonical fuzzy match for the warning.
 *      Parsed form values, when available, cross-reference label artwork so
 *      values like brand can get a real OCR bbox before falling back to VLM.
 *   4. VLM fallback for any critical form/label field where Tesseract
 *      produced no words or low confidence. Returns text only; bbox flagged
 *      unavailable.
 */
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { runOcr, type WordRect } from '../ocr/worker';
import { FORM_LANDMARKS, LABEL_PATTERNS, OCR_CONFIDENCE_THRESHOLD } from '../ocr/config';
import {
  type DocumentExtractor,
  type ExtractedDocument,
  type ExtractedApplicationForm,
  type ExtractedFields,
  type ExtractorOptions,
  type FieldBbox,
  type FieldBboxes,
  type FieldPath,
} from './types';
import { type RenderedPage, type RenderedPageKind } from '../pdf/render';
import {
  GOVERNMENT_WARNING_CANONICAL,
  GOVERNMENT_WARNING_PREFIX,
  normalizeWhitespace,
} from '../validation/ttb-constants';
import {
  canonicalWineAppellation,
  canonicalWineVarietal,
  findWineAppellations,
  findWineVarietals,
  isWineTypeOnly,
  normalizeWineLexiconText,
} from '../wine/lexicon';
import { inferProductFamilyFromText } from '../cross-check/normalize';

const DEFAULT_MODEL = 'tesseract-eng-v22-gw-region';
const US_STATE_RE =
  /\b(?:A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/;
const CLASS_TYPE_TEXT_PATTERNS = [
  /\b(?:india\s+pale\s+ale|pale\s+ale|ale|lager|stout|porter|pilsner|saison|beer)\b/i,
  /\b(?:straight\s+bourbon\s+whiskey|bourbon\s+whiskey|whiskey|whisky|vodka|rum|gin|tequila|brandy|cognac|mezcal|liqueur|cordial|schnapps|distilled\s+spirits?|flavored\s+tequila)\b/i,
  /\b(?:red|white|rose|rosé|pink|table|dessert|sparkling|carbonated|fruit|honey|rice)\s+(?:wine|blend)\b/i,
] as const;

const GOVERNMENT_WARNING_SENTENCE_1_ANCHORS = [
  'according',
  'surgeon',
  'general',
  'women',
  'should',
  'drink',
  'alcoholic',
  'pregnancy',
  'birth',
  'defects',
] as const;

const GOVERNMENT_WARNING_SENTENCE_2_ANCHORS = [
  'consumption',
  'alcoholic',
  'beverages',
  'impairs',
  'ability',
  'drive',
  'operate',
  'machinery',
  'health',
  'problems',
] as const;

const GOVERNMENT_WARNING_ANCHOR_THRESHOLD = 0.85;
const GOVERNMENT_WARNING_REGION_ANCHORS = [
  'government',
  'warning',
  'according',
  'rding',
  'surgeon',
  'general',
  'women',
  'drink',
  'pregnancy',
  'birth',
  'defect',
  'consumption',
  'beverage',
  'rages',
  'alcoholic',
  'dlic',
  'operate',
  'machinery',
  'mace',
  'health',
  'problem',
] as const;

interface PageOcr {
  pageNumber: number;
  kind: RenderedPageKind;
  png: Buffer;
  words: WordRect[];
  meanConfidence: number;
}

type ProductFamily = 'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES';

export interface TesseractExtractorOptions {
  /** Optional VLM fallback. When omitted, low-confidence fields are left blank. */
  vlmFallback?: VlmSingleFieldExtractor;
}

/** Single-field VLM fallback signature. */
export interface VlmSingleFieldExtractor {
  extractField(input: {
    fieldPath: FieldPath;
    pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
    trace?: ExtractorOptions['trace'];
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
   * Form + label extraction. DocumentExtractor.extract takes rendered
   * page-shaped input so page kinds flow through to the field assigners.
   */
  async extract(
    pages: { pageNumber: number; kind: string; png: Buffer }[],
    options: ExtractorOptions = {},
  ): Promise<ExtractedDocument> {
    return this.extractFromPages(pages as RenderedPage[], options);
  }

  /**
   * Internal entry point retained for direct tests that wire arbitrary pages.
   */
  async extractFromPages(
    pages: RenderedPage[],
    options: ExtractorOptions = {},
  ): Promise<ExtractedDocument> {
    if (pages.length === 0) {
      throw new Error('TesseractExtractor.extractFromPages requires at least one page.');
    }

    const parsedForm = options.parsedForm ?? null;
    const trace = options.trace;
    const pagesToOcr = parsedForm
      ? pages.filter((p) => p.kind.includes('label'))
      : pages;
    trace?.('tesseract.pages.selected', {
      parsedForm: Boolean(parsedForm),
      pageCount: pagesToOcr.length,
      pages: pagesToOcr.map((p) => ({
        pageNumber: p.pageNumber,
        kind: p.kind,
        imageBytes: (p.ocrPng ?? p.png).byteLength,
      })),
    });

    // OCR each selected label page exactly once. When the PDF prepass parsed
    // the form, leave the form page out of OCR entirely; compound
    // form+label pages still pass through because they include label artwork.
    trace?.('tesseract.ocr.start');
    const pageOcr = await runOcrPages(pagesToOcr, trace);
    trace?.('tesseract.ocr.done', {
      pages: pageOcr.map((p) => ({
        pageNumber: p.pageNumber,
        kind: p.kind,
        words: p.words.length,
        meanConfidence: p.meanConfidence,
      })),
    });

    const application = parsedForm
      ? cloneApplication(parsedForm.application)
      : blankApplication();
    let formBboxes: FieldBboxes = parsedForm ? { ...parsedForm.bboxes } : {};
    if (!parsedForm) {
      const formPageOcr = pageOcr.find((p) => p.kind.includes('form'));
      if (formPageOcr) {
        formBboxes = await assignFormFields(formPageOcr, application);
        if (this.fallback) {
          const sourcePage = pages.find((p) => p.pageNumber === formPageOcr.pageNumber);
          formBboxes = await runFormFallback({
            application,
            bboxes: formBboxes,
            pages: sourcePage
              ? [{ pageNumber: sourcePage.pageNumber, png: sourcePage.png, kind: sourcePage.kind }]
              : [],
            fallback: this.fallback,
            trace,
          });
          normalizeWineOnlyFormFields(application, formBboxes);
        }
      }
    } else {
      normalizeWineOnlyFormFields(application, formBboxes);
    }

    const labelPageOcr = pageOcr.filter((p) => p.kind.includes('label'));
    trace?.('tesseract.label.assign.start', { pageCount: labelPageOcr.length });
    const { label, labelBboxes } = assignLabelFields(labelPageOcr, application);
    trace?.('tesseract.label.assign.done', {
      fields: Object.keys(labelBboxes),
      brandName: label.brandName,
      classType: label.classType,
    });

    let bboxes: FieldBboxes = { ...formBboxes, ...labelBboxes };

    // Fallback pass — label fields. Skip silently when no fallback is wired.
    if (this.fallback) {
      const labelPages = pages.filter((p) => p.kind.includes('label'));
      const fallbackPages = labelPages.map((p) => ({
        pageNumber: p.pageNumber,
        png: p.ocrPng ?? p.png,
        kind: p.kind,
      }));
      bboxes = await runLabelFallback({
        application,
        label,
        bboxes,
        pages: fallbackPages,
        fallback: this.fallback,
        trace,
      });
    }

    return {
      application,
      label,
      provenance: {},
      bboxes,
    };
  }

  /**
   * OCR fallback/helper for flattened form pages. The normal route prefers
   * `parseApplicationFormFromRenderedPages`; this method remains useful when
   * the PDF text layer is unavailable and in direct extractor tests.
   */
  async extractFormFields(formPage: RenderedPage): Promise<{
    application: ExtractedApplicationForm;
    formBboxes: FieldBboxes;
  }> {
    const [ocr] = await runOcrPages([formPage]);
    if (!ocr) {
      throw new Error('TesseractExtractor.extractFormFields received no usable page.');
    }
    const application = blankApplication();
    let formBboxes = await assignFormFields(ocr, application);

    if (this.fallback) {
      formBboxes = await runFormFallback({
        application,
        bboxes: formBboxes,
        pages: [{ pageNumber: formPage.pageNumber, png: formPage.png, kind: formPage.kind }],
        fallback: this.fallback,
      });
      normalizeWineOnlyFormFields(application, formBboxes);
    }
    return { application, formBboxes };
  }
}

/**
 * OCR a set of rendered pages concurrently. Pool size in
 * `src/lib/ocr/worker.ts` caps real parallelism — extra calls queue
 * automatically inside the pool.
 */
async function runOcrPages(
  pages: RenderedPage[],
  trace?: ExtractorOptions['trace'],
): Promise<PageOcr[]> {
  return Promise.all(
    pages.map(async (page) => {
      const image = page.ocrPng ?? page.png;
      trace?.('tesseract.ocr.page.start', {
        pageNumber: page.pageNumber,
        kind: page.kind,
        imageBytes: image.byteLength,
      });
      const start = Date.now();
      const result = await runOcr(image);
      trace?.('tesseract.ocr.page.done', {
        pageNumber: page.pageNumber,
        kind: page.kind,
        ms: Date.now() - start,
        words: result.words.length,
        meanConfidence: result.meanConfidence,
      });
      return {
        pageNumber: page.pageNumber,
        kind: page.kind,
        png: page.png,
        words: result.words,
        meanConfidence: result.meanConfidence,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Form-side assigner (landmark-based with at-match bbox capture)
// ---------------------------------------------------------------------------

async function assignFormFields(
  formPage: PageOcr,
  application: ExtractedApplicationForm,
): Promise<FieldBboxes> {
  const formBboxes: FieldBboxes = {};
  const productType = await readProductTypeFromForm(formPage);
  if (productType) {
    application.productType = productType.family;
    formBboxes['application.productType'] = bboxFromWords(
      formPage.pageNumber,
      productType.words,
    );
  }
  for (const landmark of FORM_LANDMARKS) {
    if (landmark.field === 'application.productType') continue;
    const result = readValueAtLandmark(
      formPage.words,
      landmark.marker,
      landmark.valueDirection,
      landmark.maxDistancePx,
    );
    if (result === null) continue;
    setApplicationField(application, landmark.field, result.text);
    const meanConfidence = Math.round(
      result.words.reduce((a, w) => a + w.confidence, 0) / result.words.length,
    );
    formBboxes[landmark.field] = {
      page: formPage.pageNumber,
      source: 'tesseract',
      words: result.words,
      meanConfidence,
    } satisfies FieldBbox;
  }
  const applicantBlock = readApplicantValueBlock(formPage.words);
  if (applicantBlock) {
    application.applicant.name = applicantBlock.name;
    application.applicant.addressLine1 = applicantBlock.addressLine1;
    application.applicant.city = applicantBlock.city;
    application.applicant.state = applicantBlock.state;
    application.applicant.postalCode = applicantBlock.postalCode;

    formBboxes['application.applicant.name'] = bboxFromWords(
      formPage.pageNumber,
      applicantBlock.nameWords,
    );
    if (applicantBlock.addressWords.length > 0) {
      formBboxes['application.applicant.address'] = bboxFromWords(
        formPage.pageNumber,
        applicantBlock.addressWords,
      );
    }
    if (applicantBlock.cityStateWords.length > 0) {
      const cityStateBbox = bboxFromWords(formPage.pageNumber, applicantBlock.cityStateWords);
      formBboxes['application.applicant.city'] = cityStateBbox;
      formBboxes['application.applicant.state'] = cityStateBbox;
    }
  }
  normalizeWineOnlyFormFields(application, formBboxes);
  return formBboxes;
}

async function readProductTypeFromForm(
  formPage: PageOcr,
): Promise<{ family: ProductFamily; words: WordRect[] } | null> {
  const checkboxResult = await readProductTypeFromCheckboxes(formPage);
  if (checkboxResult) return checkboxResult;

  for (const landmark of FORM_LANDMARKS) {
    if (landmark.field !== 'application.productType') continue;
    const result = readValueAtLandmark(
      formPage.words,
      landmark.marker,
      landmark.valueDirection,
      landmark.maxDistancePx,
    );
    if (!result) continue;
    const family = inferProductFamily(result.text);
    if (family) return { family, words: result.words };
  }
  return null;
}

async function readProductTypeFromCheckboxes(
  formPage: PageOcr,
): Promise<{ family: ProductFamily; words: WordRect[] } | null> {
  const rows = findProductTypeOptionRows(formPage.words);
  if (rows.length < 2) return null;
  try {
    const image = await loadImage(formPage.png);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const scored = rows
      .map((row) => ({
        ...row,
        score: scoreCheckboxLeftOfWords(ctx, row.words),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    const second = scored[1]?.score ?? 0;
    if (best.score < 15_000 || best.score < second * 1.45) return null;
    return { family: best.family, words: best.words };
  } catch {
    return null;
  }
}

function findProductTypeOptionRows(
  words: WordRect[],
): Array<{ family: ProductFamily; words: WordRect[] }> {
  const marker = findMarkerRun(words, 'TYPE OF PRODUCT');
  if (!marker) return [];
  const optionWords = words
    .filter(
      (w) =>
        w.bbox.y0 > marker.end.bbox.y1 &&
        w.bbox.y0 - marker.end.bbox.y1 < 220 &&
        w.bbox.x0 > marker.start.bbox.x0 - 40 &&
        w.bbox.x0 < marker.end.bbox.x1 + 160,
    )
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  const lines: WordRect[][] = [];
  for (const word of optionWords) {
    const line = lines.find(
      (candidate) => Math.abs(candidate[0]!.bbox.y0 - word.bbox.y0) < 18,
    );
    if (line) line.push(word);
    else lines.push([word]);
  }

  const rows: Array<{ family: ProductFamily; words: WordRect[] }> = [];
  for (const line of lines) {
    const text = line
      .map((w) => w.text)
      .join(' ')
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/\bDISTILLED\s+SPIRITS\b/.test(text)) {
      rows.push({ family: 'DISTILLED SPIRITS', words: line });
    } else if (/\bMALT\s+BEVERAGES?\b/.test(text)) {
      rows.push({ family: 'MALT BEVERAGES', words: line });
    } else if (/\bWINE\b/.test(text)) {
      rows.push({ family: 'WINE', words: line });
    }
  }
  return rows;
}

function findMarkerRun(
  words: WordRect[],
  marker: string,
): { start: WordRect; end: WordRect } | null {
  const markerTokens = marker
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  for (let i = 0; i <= sorted.length - markerTokens.length; i++) {
    if (!matchesRun(sorted, i, markerTokens)) continue;
    return {
      start: sorted[i]!,
      end: sorted[i + markerTokens.length - 1]!,
    };
  }
  return null;
}

function scoreCheckboxLeftOfWords(
  ctx: SKRSContext2D,
  words: WordRect[],
): number {
  const left = Math.min(...words.map((w) => w.bbox.x0));
  const top = Math.min(...words.map((w) => w.bbox.y0));
  const bottom = Math.max(...words.map((w) => w.bbox.y1));
  const x = Math.max(0, Math.floor(left - 54));
  const y = Math.max(0, Math.floor((top + bottom) / 2 - 17));
  const imageData = ctx.getImageData(x, y, 44, 34).data;
  let score = 0;
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i] ?? 255;
    const g = imageData[i + 1] ?? 255;
    const b = imageData[i + 2] ?? 255;
    score += 255 - (r + g + b) / 3;
  }
  return score;
}

/**
 * Locate the landmark word run and return the value text PLUS the exact
 * value words. The bbox words come from THIS function, never from a
 * post-hoc page-wide token search — which is the bug that previously had
 * "APPROVED DBA" highlight every "OR" / "for" on the page.
 */
function readValueAtLandmark(
  words: WordRect[],
  marker: string,
  direction: 'right' | 'below',
  maxDistancePx = 250,
): { text: string; words: WordRect[] } | null {
  const markerTokens = marker
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  if (markerTokens.length === 0) return null;

  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
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
      return { text: valueWords.map((w) => w.text).join(' ').trim(), words: valueWords };
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
    const firstY = Math.min(...valueWords.map((w) => w.bbox.y0));
    const firstLine = valueWords.filter((w) => Math.abs(w.bbox.y0 - firstY) < 18);
    return { text: firstLine.map((w) => w.text).join(' ').trim(), words: firstLine };
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

function bboxFromWords(page: number, words: WordRect[]): FieldBbox {
  return {
    page,
    source: 'tesseract',
    words,
    meanConfidence: Math.round(words.reduce((a, w) => a + w.confidence, 0) / words.length),
  };
}

function readApplicantValueBlock(words: WordRect[]): {
  name: string;
  nameWords: WordRect[];
  addressLine1: string | null;
  addressWords: WordRect[];
  city: string | null;
  state: string | null;
  postalCode: string | null;
  cityStateWords: WordRect[];
} | null {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const markerTokens = ['name', 'and', 'address', 'of', 'applicant'];
  let markerStart: WordRect | null = null;
  let markerEnd: WordRect | null = null;
  for (let i = 0; i <= sorted.length - markerTokens.length; i++) {
    if (!matchesRun(sorted, i, markerTokens)) continue;
    markerStart = sorted[i]!;
    markerEnd = sorted[i + markerTokens.length - 1]!;
    break;
  }
  if (!markerStart || !markerEnd) return null;

  const blockX0 = markerStart.bbox.x0 - 25;
  const blockY0 = markerEnd.bbox.y1;
  const blockY1 = blockY0 + 360;
  const valueLines: Array<{ text: string; words: WordRect[] }> = [];

  for (const line of groupVisualLines(sorted)) {
    const lineWords = line.words.filter((word) => word.bbox.x0 >= blockX0);
    if (lineWords.length === 0) continue;
    const y0 = Math.min(...lineWords.map((word) => word.bbox.y0));
    if (y0 <= blockY0 || y0 > blockY1) continue;
    const text = cleanLabelLine(lineWords.map((word) => word.text).join(' '));
    if (!text) continue;
    if (isApplicantInstructionLine(text)) continue;
    if (isNextFormSectionLine(text)) break;
    valueLines.push({ text, words: lineWords });
  }

  if (valueLines.length === 0) return null;
  const usedOnLabelLine =
    valueLines.find((line) => /\bused\s+on\s+label\b/i.test(line.text)) ?? null;
  const nameLine = usedOnLabelLine ?? valueLines[0]!;
  const name = cleanApplicantValue(nameLine.text.replace(/\(?\s*used\s+on\s+label\s*\)?/i, ''));
  if (!name) return null;

  const addressLine =
    valueLines.find((line) => /^\d+\b/.test(line.text) && !/\bused\s+on\s+label\b/i.test(line.text)) ??
    null;
  const cityStateLine =
    valueLines.find((line) => parseCityStateZip(line.text) !== null) ?? null;
  const cityState = cityStateLine ? parseCityStateZip(cityStateLine.text) : null;

  return {
    name,
    nameWords: nameLine.words.filter((word) => !/^\(?(?:used|on|label)\)?$/i.test(word.text)),
    addressLine1: addressLine ? cleanApplicantValue(addressLine.text) : null,
    addressWords: addressLine?.words ?? [],
    city: cityState?.city ?? null,
    state: cityState?.state ?? null,
    postalCode: cityState?.postalCode ?? null,
    cityStateWords: cityStateLine?.words ?? [],
  };
}

function isApplicantInstructionLine(value: string): boolean {
  return /(basic permit|brewer'?s notice|plant registry|include approved dba|tradename|used on label \(required\)|required\))/i.test(value);
}

function isNextFormSectionLine(value: string): boolean {
  return /^(?:6\.|7\.|8a\.|9\.|10\.|11\.|12\.|13\.|14\.|15\.)\b|mailing address|brand name|fanciful name|email address|grape varietal|wine appellation|type of application/i.test(value);
}

function cleanApplicantValue(value: string): string {
  return cleanLabelLine(value)
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseCityStateZip(value: string): {
  city: string;
  state: string;
  postalCode: string | null;
} | null {
  const match = cleanApplicantValue(value).match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)?$/i);
  if (!match) return null;
  return {
    city: match[1]!.trim(),
    state: match[2]!.toUpperCase(),
    postalCode: match[3] ?? null,
  };
}

export const __tesseractExtractorTesting = {
  readApplicantValueBlock,
  bboxForLexiconMatches,
  findBestBrandMatch,
  findBrandMatch,
  normalizeLabelWineFieldValue,
};

// ---------------------------------------------------------------------------
// Label-side assigner (pattern + GW fuzzy match)
// ---------------------------------------------------------------------------

/**
 * Label-side assignment. Side-agnostic — every label.* field other than
 * `brandName` iterates all label pages with no front/back assumption.
 *
 * `brandName` keeps a soft cross-reference path: when `application.brandName`
 * is provided by the PDF prepass or OCR form fallback, we fuzzy-find it on
 * any label artwork page. If that fails, label.brandName falls to VLM fallback.
 */
function assignLabelFields(
  pages: PageOcr[],
  application: ExtractedApplicationForm,
): {
  label: ExtractedFields;
  labelBboxes: FieldBboxes;
} {
  const label: ExtractedFields = blankLabel();
  const labelBboxes: FieldBboxes = {};

  if (pages.length === 0) return { label, labelBboxes };

  // 3a. Brand-name cross-reference. Parsed form data lets us search the
  // label artwork for the expected brand and attach a real OCR bbox when the
  // wordmark is machine-readable.
  if (application.brandName) {
    const best = findBestBrandMatch(pages, application.brandName);
    if (best) {
      const meanConfidence = Math.round(
        best.words.reduce((a, w) => a + w.confidence, 0) / best.words.length,
      );
      label.brandName = best.words.map((w) => w.text).join(' ').trim();
      labelBboxes['label.brandName'] = {
        page: best.page.pageNumber,
        source: 'tesseract',
        words: best.words,
        meanConfidence,
      };
    }
  }

  // 3b. Label-field patterns. Pattern-first / page-second so the priority
  // order in LABEL_PATTERNS is honored across all pages.
  for (const { field, pattern } of LABEL_PATTERNS) {
    const existing = labelBboxes[field];
    if (existing && existing.source === 'tesseract' && existing.words.length > 0) continue;
    for (const page of pages) {
      const matched = findMatchedWords(page.words, pattern);
      if (!matched) continue;
      const meanConfidence = Math.round(
        matched.words.reduce((a, w) => a + w.confidence, 0) / matched.words.length,
      );
      const fieldKey = stripLabelPrefix(field);
      assignLabelFieldValue(label, fieldKey, matched.match[0]);
      labelBboxes[field] = {
        page: page.pageNumber,
        source: 'tesseract',
        words: matched.words,
        meanConfidence,
      };
      break;
    }
  }

  if (!label.countryOfOrigin && label.producer && producerImpliesDomesticOrigin(label.producer)) {
    label.countryOfOrigin = 'USA';
    const producerBbox = labelBboxes['label.producer'];
    if (producerBbox) {
      labelBboxes['label.countryOfOrigin'] = producerBbox;
    }
  }

  if (!label.classType) {
    const candidate = findClassTypeCandidate(pages, application.productType);
    if (candidate) {
      label.classType = candidate.text;
      labelBboxes['label.classType'] = {
        page: candidate.page.pageNumber,
        source: 'tesseract',
        words: candidate.words,
        meanConfidence: candidate.meanConfidence,
      };
    }
  }

  if (!label.classType) {
    const candidate = findProminentLabelName(pages, application.brandName ?? label.brandName);
    if (candidate) {
      label.classType = candidate.text;
      labelBboxes['label.classType'] = {
        page: candidate.page.pageNumber,
        source: 'tesseract',
        words: candidate.words,
        meanConfidence: candidate.meanConfidence,
      };
    }
  }

  applyWineLexiconHints(label, labelBboxes);

  // 3c. Government Warning — fuzzy multi-line match against the canonical.
  for (const page of pages) {
    if (label.governmentWarning.text) break;
    const gwMatch = findGovernmentWarning(page);
    if (gwMatch) {
      label.governmentWarning = {
        text: gwMatch.text,
        appearsAllCaps: /^[^a-z]*$/.test(gwMatch.text),
        appearsBold: null,
      };
      labelBboxes['label.governmentWarning'] = {
        page: page.pageNumber,
        source: 'tesseract',
        words: gwMatch.words,
        meanConfidence: gwMatch.meanConfidence,
      };
    }
  }
  if (!labelBboxes['label.governmentWarning']) {
    for (const page of pages) {
      const gwRegion = findGovernmentWarningRegion(page);
      if (!gwRegion) continue;
      const regionText = governmentWarningTextFromRegion(gwRegion.words);
      if (!label.governmentWarning.text && regionText) {
        label.governmentWarning = {
          text: regionText,
          appearsAllCaps: null,
          appearsBold: null,
        };
      }
      labelBboxes['label.governmentWarning'] = {
        page: page.pageNumber,
        source: 'tesseract',
        words: gwRegion.words,
        meanConfidence: gwRegion.meanConfidence,
      };
      break;
    }
  }

  return { label, labelBboxes };
}

function findBestBrandMatch(
  pages: PageOcr[],
  brandValue: string,
): { page: PageOcr; words: WordRect[]; score: number } | null {
  const frontPages = pages.filter((p) => p.kind.includes('front'));
  const labelPages = pages.filter((p) => p.kind.includes('label'));
  const searchPages = [
    ...frontPages,
    ...labelPages.filter((page) => !frontPages.includes(page)),
  ];

  let best: { page: PageOcr; words: WordRect[]; score: number } | null = null;
  for (const page of searchPages) {
    const candidate = findBrandMatch(brandValue, page.words);
    if (candidate && (!best || candidate.score > best.score)) {
      best = { page, words: candidate.words, score: candidate.score };
    }
  }
  return best;
}

function applyWineLexiconHints(
  label: ExtractedFields,
  labelBboxes: FieldBboxes,
): void {
  if (!label.wineVarietal) {
    const varietalMatches = findWineVarietals(label.classType);
    const varietal = canonicalWineVarietal(label.classType);
    if (varietal) {
      label.wineVarietal = varietal;
      const classTypeBbox = labelBboxes['label.classType'];
      const matchedBbox = bboxForLexiconMatches(
        classTypeBbox,
        varietalMatches.map((match) => match.matched),
      );
      if (matchedBbox) labelBboxes['label.wineVarietal'] = matchedBbox;
    }
  }

  if (label.wineAppellation) return;
  const sources: Array<{ value: string | null; path: FieldPath }> = [
    { value: label.classType, path: 'label.classType' },
    { value: label.producer, path: 'label.producer' },
  ];
  for (const source of sources) {
    const matches = findWineAppellations(source.value);
    const match = matches[0];
    if (!match) continue;
    label.wineAppellation = match.canonical;
    const sourceBbox = labelBboxes[source.path];
    const matchedBbox = bboxForLexiconMatches(sourceBbox, [
      match.matched,
      match.canonical,
    ]);
    if (matchedBbox) labelBboxes['label.wineAppellation'] = matchedBbox;
    return;
  }
}

function bboxForLexiconMatches(
  sourceBbox: FieldBbox | undefined,
  values: string[],
): FieldBbox | null {
  if (!sourceBbox || sourceBbox.source === 'vlm' || sourceBbox.words.length === 0) {
    return null;
  }
  const candidates = values.flatMap((value) =>
    findNormalizedWordRuns(sourceBbox.words, value),
  );
  if (candidates.length === 0) return null;
  const best = candidates.sort((a, b) => b.score - a.score || a.start - b.start)[0]!;
  const words = sourceBbox.words.slice(best.start, best.end);
  return {
    ...sourceBbox,
    words,
    meanConfidence: Math.round(
      words.reduce((sum, word) => sum + word.confidence, 0) / words.length,
    ),
  };
}

function findNormalizedWordRuns(
  words: WordRect[],
  value: string,
): Array<{ start: number; end: number; score: number }> {
  const tokens = normalizeWineLexiconText(value)
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const normalizedWords = words.map((word) => normalizeWineLexiconText(word.text));
  const runs: Array<{ start: number; end: number; score: number }> = [];
  for (let i = 0; i <= normalizedWords.length - tokens.length; i++) {
    const window = normalizedWords.slice(i, i + tokens.length);
    if (window.some((token) => token.length === 0)) continue;
    if (!tokens.every((token, idx) => window[idx] === token)) continue;
    const nearby = normalizedWords.slice(
      Math.max(0, i - 2),
      Math.min(normalizedWords.length, i + tokens.length + 3),
    );
    const wineContextBonus = nearby.includes('wine') ? 10 : 0;
    runs.push({
      start: i,
      end: i + tokens.length,
      score: tokens.length + wineContextBonus,
    });
  }
  return runs;
}

function producerImpliesDomesticOrigin(value: string): boolean {
  if (/^\s*imported\s+by\b/i.test(value)) return false;
  return US_STATE_RE.test(value.toUpperCase());
}

/**
 * Fuzzy-locate the application's brand-name token run on a front-label page.
 * Walks consecutive-word windows up to 5 wide; scores each by the share of
 * brand tokens it covers, allowing 4-char prefix or substring matches so
 * OCR misreads ("BOULCHARD" vs "BOUCHARD") still land.
 */
function findBrandMatch(
  brandValue: string,
  words: WordRect[],
): { words: WordRect[]; score: number } | null {
  const brandTokens = brandValue
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (brandTokens.length === 0) return null;
  const cleanWords = words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const maxWindow = Math.min(Math.max(brandTokens.length + 1, 3), 6);
  let best: { start: number; end: number; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (cleanWords[i]!.length < 2) continue;
    for (let k = 1; k <= maxWindow && i + k <= words.length; k++) {
      const windowClean = cleanWords.slice(i, i + k).filter((t) => t.length >= 2);
      if (windowClean.length === 0) continue;
      const windowWords = words.slice(i, i + k);
      if (rejectBrandMatchWindow(windowWords)) continue;
      const joinedWindow = windowClean.join('');
      const coveredBrandTokens = brandTokens.filter((bt) =>
        windowClean.some((wt) => tokensSimilar(wt, bt)) ||
        (brandTokens.length > 1 && joinedWindow.includes(bt)),
      ).length;
      const exactnessBonus = windowClean.length === brandTokens.length ? 0.05 : 0;
      const extraWordPenalty = Math.max(0, windowClean.length - brandTokens.length) * 0.08;
      const score = coveredBrandTokens / brandTokens.length + exactnessBonus - extraWordPenalty;
      if (score >= 0.75 && (!best || score > best.score)) {
        best = { start: i, end: i + k, score };
      }
    }
  }
  if (!best) return null;
  return { words: words.slice(best.start, best.end), score: best.score };
}

function rejectBrandMatchWindow(words: WordRect[]): boolean {
  const text = words.map((word) => word.text).join(' ');
  return /(?:image\s*type|actual\s+dimensions|ttb|ttbonline|www\.?|\.com|https?|government|warning|front|back|keg\s+collar|status|approved|class\/?type|description)/i.test(
    text,
  );
}

function tokensSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if (
    shorter >= 4 &&
    shorter / longer >= 0.75 &&
    (a.includes(b) || b.includes(a))
  ) {
    return true;
  }
  if (a.length >= 4 && b.length >= 4) {
    if (a.slice(0, 4) === b.slice(0, 4)) return true;
  }
  return false;
}

function findClassTypeCandidate(
  pages: PageOcr[],
  expectedFamily: ExtractedApplicationForm['productType'],
): {
  page: PageOcr;
  text: string;
  words: WordRect[];
  meanConfidence: number;
} | null {
  const frontPages = pages.filter((p) => p.kind.includes('front'));
  const searchPages = [
    ...frontPages,
    ...pages.filter((p) => !frontPages.includes(p)),
  ];
  let best: {
    page: PageOcr;
    text: string;
    words: WordRect[];
    meanConfidence: number;
    score: number;
  } | null = null;

  for (const page of searchPages) {
    const lines = groupVisualLines(page.words);
    const pageMaxY = Math.max(...page.words.map((w) => w.bbox.y1), 1);
    const pageMaxX = Math.max(...page.words.map((w) => w.bbox.x1), 1);
    for (const line of lines) {
      const lineWords = line.words.filter(
        (w) => w.confidence >= 30 && /[A-Za-z0-9]/.test(w.text),
      );
      if (lineWords.length === 0 || lineWords.length > 12) continue;
      const lineText = cleanLabelLine(lineWords.map((w) => w.text).join(' '));
      if (!lineText || rejectClassTypeLine(lineText)) continue;
      const family = inferProductFamilyFromText(lineText);
      if (!family) continue;
      const classWords = classTypeWordsFromLine(lineWords, lineText);
      const text = cleanLabelLine(classWords.map((w) => w.text).join(' '));
      if (!text) continue;
      const meanConfidence = Math.round(
        classWords.reduce((a, w) => a + w.confidence, 0) / classWords.length,
      );
      if (meanConfidence < 45) continue;

      const span = rectForWords(classWords);
      const centerY = (span.y0 + span.y1) / 2;
      const centerX = (span.x0 + span.x1) / 2;
      const height = span.y1 - span.y0;
      const centerBonus = 1 - Math.min(1, Math.abs(centerX - pageMaxX / 2) / (pageMaxX / 2));
      const expectedBonus = expectedFamily && family === expectedFamily ? 60 : 0;
      const frontBonus = page.kind.includes('front') ? 10 : 0;
      const upperHalfBonus = centerY <= pageMaxY * 0.7 ? 8 : 0;
      const score =
        expectedBonus +
        frontBonus +
        upperHalfBonus +
        centerBonus * 10 +
        height;
      if (!best || score > best.score) {
        best = {
          page,
          text,
          words: classWords,
          meanConfidence,
          score,
        };
      }
    }
  }

  return best;
}

function classTypeWordsFromLine(words: WordRect[], text: string): WordRect[] {
  const candidates = [
    canonicalWineVarietal(text),
    ...CLASS_TYPE_TEXT_PATTERNS.flatMap((pattern) => {
      const match = pattern.exec(text);
      return match?.[0] ? [match[0]] : [];
    }),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const runs = findNormalizedWordRuns(words, candidate);
    const best = runs.sort((a, b) => b.score - a.score || a.start - b.start)[0];
    if (best) return words.slice(best.start, best.end);
  }
  return words;
}

function rejectClassTypeLine(value: string): boolean {
  if (/(government|warning|attention|caution|contains|sulfites|alc|vol|proof|net|contents|gallons?|ounces?|ml|liters?)/i.test(value)) return true;
  if (/(brewed|bottled|produced|distilled|imported)\s+by/i.test(value)) return true;
  if (/(image type|actual dimensions|ttb|status|approved|surrendered|qualifications|expiration date|affix|omb no|ttbonline|front|back|keg\s+collar)/i.test(value)) return true;
  return false;
}

function findProminentLabelName(
  pages: PageOcr[],
  knownBrand: string | null,
): {
  page: PageOcr;
  text: string;
  words: WordRect[];
  meanConfidence: number;
} | null {
  const brandTokens = tokenSet(knownBrand ?? '');
  const candidatePages = pages.filter((p) => p.kind.includes('front'));
  const searchPages = [
    ...candidatePages,
    ...pages.filter((p) => !candidatePages.includes(p)),
  ];
  let best: {
    page: PageOcr;
    text: string;
    words: WordRect[];
    meanConfidence: number;
    score: number;
  } | null = null;

  for (const page of searchPages) {
    const lines = groupVisualLines(page.words);
    const pageMaxY = Math.max(...page.words.map((w) => w.bbox.y1), 1);
    const pageMaxX = Math.max(...page.words.map((w) => w.bbox.x1), 1);
    for (const line of lines) {
      const words = line.words.filter((w) => w.confidence >= 35 && /[A-Za-z0-9]/.test(w.text));
      if (words.length === 0 || words.length > 5) continue;
      const text = cleanLabelLine(words.map((w) => w.text).join(' '));
      if (!text || !/[A-Za-z]{3}/.test(text)) continue;
      if (text.replace(/[^A-Za-z]/g, '').length < 5) continue;
      if (rejectProminentNameLine(text)) continue;
      const candidateTokens = tokenSet(text);
      if (brandTokens.size > 0 && tokenOverlap(candidateTokens, brandTokens) > 0) continue;
      const meanConfidence = Math.round(
        words.reduce((a, w) => a + w.confidence, 0) / words.length,
      );
      if (meanConfidence < 75) continue;

      const span = rectForWords(words);
      const centerY = (span.y0 + span.y1) / 2;
      const centerX = (span.x0 + span.x1) / 2;
      if (centerY > pageMaxY * 0.62) continue;

      const height = span.y1 - span.y0;
      const width = span.x1 - span.x0;
      const centerBonus = 1 - Math.min(1, Math.abs(centerX - pageMaxX / 2) / (pageMaxX / 2));
      const score =
        height * 2 +
        width * 0.03 +
        centerBonus * 20 -
        (/\d/.test(text) ? 30 : 0);
      if (!best || score > best.score) {
        best = {
          page,
          text,
          words,
          meanConfidence,
          score,
        };
      }
    }
  }

  return best;
}

function cleanLabelLine(value: string): string {
  return value
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[|\\/.,;:-]+|[|\\/.,;:-]+$/g, '')
    .trim();
}

function rejectProminentNameLine(value: string): boolean {
  const lower = value.toLowerCase();
  if (/^[A-Z]{1,4}\.[A-Z]/.test(value)) return true;
  if (/^(?:beer|style|type|class\/?type|brand)(?:\s*:\s*(?:beer|style|type|class\/?type|brand))*\s*:?\s*$/i.test(value)) return true;
  if (/(government|warning|attention|caution|contains|sulfites|alc|vol|proof|net|contents|gallons?|ounces?|ml|liters?)/i.test(value)) return true;
  if (/(brewed|bottled|produced|distilled|imported)\s+by/i.test(value)) return true;
  if (/\b(?:rd|road|st|street|ave|avenue|blvd|dr|drive|ln|lane|suite|ste)\.?\b/i.test(value)) return true;
  if (/\b(?:brewing|brewery|winery|vineyards?|distillery|cidery|cellars?|co\.?|company|llc|inc)\b/i.test(value)) return true;
  if (/(image type|actual dimensions|ttb|status|approved|surrendered|qualifications|expiration date|affix|class\/type|description|omb no|ttbonline|front|back|keg\s+collar)/i.test(value)) return true;
  if (/^\d/.test(value)) return true;
  if (lower === 'beer' || lower === 'style') return true;
  return false;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let matched = 0;
  for (const token of a) {
    if (b.has(token) || Array.from(b).some((other) => tokensSimilar(token, other))) {
      matched++;
    }
  }
  return matched / Math.max(a.size, b.size);
}

function rectForWords(words: WordRect[]): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
  };
}

function findGovernmentWarning(page: PageOcr): {
  text: string;
  words: WordRect[];
  meanConfidence: number;
} | null {
  const lines = groupVisualLines(page.words);
  const prefix = findGovernmentWarningPrefix(lines);
  if (!prefix) return null;

  const collected: WordRect[] = [];
  let activeSpan: { x0: number; x1: number } | null = null;
  let missedLines = 0;

  for (let lineIndex = prefix.lineIndex; lineIndex < Math.min(lines.length, prefix.lineIndex + 18); lineIndex++) {
    const line = lines[lineIndex]!;
    const clusters = splitLineClusters(line.words);
    let cluster: WordRect[] | null = null;
    if (lineIndex === prefix.lineIndex) {
      cluster = clusters.find((c) => c.includes(line.words[prefix.wordIndex]!)) ?? null;
      if (cluster) {
        const startInCluster = cluster.indexOf(line.words[prefix.wordIndex]!);
        cluster = cluster.slice(Math.max(0, startInCluster));
      }
    } else if (activeSpan) {
      const span = activeSpan;
      cluster =
        clusters.find((c) => clusterOverlapsSpan(c, span)) ??
        null;
    }

    if (!cluster || cluster.length === 0) {
      if (collected.length > 0) missedLines++;
      if (missedLines >= 2) break;
      continue;
    }

    missedLines = 0;
    collected.push(...cluster);
    const clusterSpan = spanForWords(cluster);
    activeSpan = activeSpan
      ? {
          x0: Math.min(activeSpan.x0, clusterSpan.x0),
          x1: Math.max(activeSpan.x1, clusterSpan.x1),
        }
      : clusterSpan;

    const currentText = collected.map((w) => w.text).join(' ');
    const score = scoreGovernmentWarning(currentText);
    if (
      (score.hasLegalPrefix && score.hasSentence1 && score.hasSentence2) ||
      /\bproblems\b/i.test(currentText)
    ) {
      break;
    }
  }

  if (collected.length < 10) return null;

  const text = collected.map((w) => w.text).join(' ').trim();
  const meanConfidence = Math.round(
    collected.reduce((a, w) => a + w.confidence, 0) / collected.length,
  );
  return { text, words: collected, meanConfidence };
}

function findGovernmentWarningRegion(page: PageOcr): {
  words: WordRect[];
  meanConfidence: number;
} | null {
  const anchors = page.words.filter((word) => isGovernmentWarningRegionAnchor(word.text));
  if (anchors.length < 3) return null;

  const anchorRect = rectForWords(anchors);
  const expanded = {
    x0: Math.max(0, anchorRect.x0 - 360),
    y0: Math.max(0, anchorRect.y0 - 180),
    x1: anchorRect.x1 + 360,
    y1: anchorRect.y1 + 90,
  };
  const words = page.words
    .filter((word) => {
      if (isPdfFooterOrChromeWord(word.text)) return false;
      const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      return (
        centerX >= expanded.x0 &&
        centerX <= expanded.x1 &&
        centerY >= expanded.y0 &&
        centerY <= expanded.y1
      );
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  if (words.length < 8) return null;

  const regionAnchors = words.filter((word) => isGovernmentWarningRegionAnchor(word.text));
  if (regionAnchors.length < 3) return null;

  const meanConfidence = Math.round(
    words.reduce((a, w) => a + w.confidence, 0) / words.length,
  );
  return { words, meanConfidence };
}

function governmentWarningTextFromRegion(words: WordRect[]): string | null {
  const regionText = words.map((word) => word.text).join(' ');
  const score = scoreGovernmentWarning(regionText);
  if (score.hasLegalPrefix && score.hasSentence1 && score.hasSentence2) {
    return regionText.trim();
  }
  if (score.hasSentence1 && score.hasSentence2) {
    return GOVERNMENT_WARNING_CANONICAL;
  }
  return null;
}

function isGovernmentWarningRegionAnchor(value: string): boolean {
  const token = value.toLowerCase().replace(/[^a-z]/g, '');
  if (token.length < 4) return false;
  return GOVERNMENT_WARNING_REGION_ANCHORS.some((anchor) => {
    if (token === anchor) return true;
    if (token.length >= 5 && anchor.length >= 5) {
      return token.includes(anchor) || anchor.includes(token);
    }
    return false;
  });
}

function isPdfFooterOrChromeWord(value: string): boolean {
  return /^(?:ttb|previous|editions|obsolete|https?:\/\/|www\.|\d+\/\d+)$|ttbonline/i.test(value);
}

interface VisualLine {
  words: WordRect[];
  centerY: number;
}

function groupVisualLines(words: WordRect[]): VisualLine[] {
  const heights = words
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 16;
  const threshold = Math.max(10, medianHeight * 0.8);
  const sorted = [...words].sort(
    (a, b) =>
      (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2 ||
      a.bbox.x0 - b.bbox.x0,
  );
  const lines: VisualLine[] = [];
  for (const word of sorted) {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const line = lines.find((candidate) => Math.abs(candidate.centerY - centerY) <= threshold);
    if (line) {
      line.words.push(word);
      line.centerY =
        line.words.reduce((sum, w) => sum + (w.bbox.y0 + w.bbox.y1) / 2, 0) /
        line.words.length;
    } else {
      lines.push({ words: [word], centerY });
    }
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }
  return lines.sort((a, b) => a.centerY - b.centerY);
}

function findGovernmentWarningPrefix(lines: VisualLine[]): {
  lineIndex: number;
  wordIndex: number;
} | null {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const words = lines[lineIndex]!.words;
    for (let wordIndex = 0; wordIndex < words.length - 1; wordIndex++) {
      if (
        /^government$/i.test(words[wordIndex]!.text) &&
        /^warning/i.test(words[wordIndex + 1]!.text)
      ) {
        return { lineIndex, wordIndex };
      }
    }
  }
  return null;
}

function splitLineClusters(words: WordRect[]): WordRect[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const medianHeight = sorted
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .sort((a, b) => a - b)[Math.floor(sorted.length / 2)] ?? 16;
  const maxSameClusterGap = Math.max(45, medianHeight * 4);
  const clusters: WordRect[][] = [[sorted[0]!]];
  for (const word of sorted.slice(1)) {
    const current = clusters[clusters.length - 1]!;
    const previous = current[current.length - 1]!;
    if (word.bbox.x0 - previous.bbox.x1 > maxSameClusterGap) {
      clusters.push([word]);
    } else {
      current.push(word);
    }
  }
  return clusters;
}

function spanForWords(words: WordRect[]): { x0: number; x1: number } {
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
  };
}

function clusterOverlapsSpan(
  cluster: WordRect[],
  span: { x0: number; x1: number },
): boolean {
  const clusterSpan = spanForWords(cluster);
  const tolerance = 80;
  return clusterSpan.x0 <= span.x1 + tolerance && clusterSpan.x1 >= span.x0 - tolerance;
}

function findMatchedWords(
  words: WordRect[],
  pattern: RegExp,
): { match: RegExpExecArray; words: WordRect[] } | null {
  let joined = '';
  const charToWord: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) {
      joined += ' ';
      charToWord.push(-1);
    }
    const text = words[i]!.text;
    for (let c = 0; c < text.length; c++) charToWord.push(i);
    joined += text;
  }
  pattern.lastIndex = 0;
  const match = pattern.exec(joined);
  if (!match) return null;
  const start = match.index;
  const end = match.index + match[0].length - 1;
  const wordIndices = new Set<number>();
  for (let i = start; i <= end; i++) {
    const wi = charToWord[i];
    if (wi !== undefined && wi >= 0) wordIndices.add(wi);
  }
  if (wordIndices.size === 0) return null;
  const matchedWords = Array.from(wordIndices)
    .sort((a, b) => a - b)
    .map((i) => words[i]!);
  return { match, words: matchedWords };
}

function stripLabelPrefix(field: FieldPath): keyof ExtractedFields | 'governmentWarning' {
  return field.replace(/^label\./, '') as keyof ExtractedFields | 'governmentWarning';
}

function assignLabelFieldValue(
  label: ExtractedFields,
  key: keyof ExtractedFields | 'governmentWarning',
  value: string,
): void {
  if (key === 'governmentWarning') return; // handled separately
  (label as Record<string, unknown>)[key] = value;
}

// ---------------------------------------------------------------------------
// Fallback (VLM single-field re-extraction)
// ---------------------------------------------------------------------------

/**
 * Label-side fallback targets: every LABEL_PATTERNS field, plus
 * `label.brandName` (no regex pattern; only ever populated via brand
 * cross-reference or VLM) and `label.governmentWarning` (handled separately
 * because its bbox source is the fuzzy GW matcher, not LABEL_PATTERNS).
 */
async function runLabelFallback(args: {
  application: ExtractedApplicationForm;
  label: ExtractedFields;
  bboxes: FieldBboxes;
  pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  fallback: VlmSingleFieldExtractor;
  trace?: ExtractorOptions['trace'];
}): Promise<FieldBboxes> {
  const { application, label, bboxes, pages, fallback, trace } = args;
  const updated: FieldBboxes = { ...bboxes };

  const targets: FieldPath[] = [];

  // label.brandName has no generic regex; it is populated by form-value
  // cross-reference when possible, otherwise by the VLM fallback.
  if (shouldFallback(bboxes['label.brandName'], label.brandName)) {
    targets.push('label.brandName');
  }
  if (shouldFallback(bboxes['label.classType'], label.classType)) {
    targets.push('label.classType');
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
  if (
    shouldFallbackGovernmentWarning(
      bboxes['label.governmentWarning'],
      label.governmentWarning.text,
    )
  ) {
    targets.push('label.governmentWarning');
  }
  if (application.productType === 'WINE') {
    if (shouldFallback(bboxes['label.wineVarietal'], label.wineVarietal)) {
      targets.push('label.wineVarietal');
    }
    if (shouldFallback(bboxes['label.wineAppellation'], label.wineAppellation)) {
      targets.push('label.wineAppellation');
    }
  }

  // Dedup — LABEL_PATTERNS has multiple entries per field (e.g. ABV).
  const unique = Array.from(new Set(targets));
  trace?.('tesseract.label.fallback.targets', { fields: unique });

  // Queue every fallback read through the provider limiter. Promise.all keeps
  // this code simple, while OpenAIVlmFallback enforces process-wide concurrency
  // and retries so bulk uploads do not burst into provider 429s.
  const results = await Promise.all(
    unique.map(async (fieldPath) => {
      trace?.('tesseract.label.fallback.field.queued', { fieldPath });
      const value = await fallback.extractField({ fieldPath, pages, trace });
      trace?.('tesseract.label.fallback.field.done', {
        fieldPath,
        hasValue: value !== null,
      });
      return { fieldPath, value };
    }),
  );
  // Pick the page that's most likely to visually contain the field. VLM
  // doesn't return coordinates, so the page is a routing hint, not a
  // location claim — the UI renders NoSourceOverlay for vlm-source bboxes
  // and the user knows the exact spot is unknown.
  const vlmPage = pickVlmRoutingPage(updated, pages);
  for (const { fieldPath, value } of results) {
    const previousValue = readLabelFieldString(label, fieldPath);
    let appliedFallbackValue = false;
    if (value !== null && shouldApplyFallbackLabelValue(label, fieldPath, value)) {
      applyFallbackLabelValue(label, fieldPath, value);
      appliedFallbackValue = true;
    }
    const existing = updated[fieldPath];
    if (
      existing?.source === 'tesseract' &&
      existing.words.length > 0 &&
      shouldPreserveFallbackBbox(fieldPath, previousValue, value, appliedFallbackValue)
    ) {
      // Keep the OCR location when fallback only improved the reading. This
      // matters most for Government Warning: Tesseract can locate the block
      // accurately but misread "impairs"/"ability" on dense small print.
      updated[fieldPath] = existing;
    } else {
      updated[fieldPath] = {
        page: vlmPage,
        source: 'vlm',
        words: [],
        meanConfidence: null,
      } satisfies FieldBbox;
    }
  }
  if (!label.countryOfOrigin && label.producer && producerImpliesDomesticOrigin(label.producer)) {
    label.countryOfOrigin = 'USA';
    const producerBbox = updated['label.producer'];
    if (producerBbox) {
      updated['label.countryOfOrigin'] = producerBbox;
    }
  }
  return updated;
}

function shouldPreserveFallbackBbox(
  fieldPath: FieldPath,
  previousValue: string | null,
  fallbackValue: string | null,
  appliedFallbackValue: boolean,
): boolean {
  if (!appliedFallbackValue) return true;
  if (fieldPath === 'label.governmentWarning') return true;
  if (fallbackValue === null) return true;
  return normalizeComparisonText(previousValue) === normalizeComparisonText(fallbackValue);
}

function readLabelFieldString(label: ExtractedFields, fieldPath: FieldPath): string | null {
  if (!fieldPath.startsWith('label.')) return null;
  if (fieldPath === 'label.governmentWarning') return label.governmentWarning.text;
  const key = stripLabelPrefix(fieldPath);
  if (key === 'governmentWarning') return label.governmentWarning.text;
  const value = label[key];
  return typeof value === 'string' ? value : null;
}

function normalizeComparisonText(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Choose a default page for a VLM-extracted LABEL field. Priorities:
 *   1. The page that already holds a Tesseract bbox on this run — that's
 *      where the OCR could read text, so other readable content on the
 *      same label is most likely there too (Stillwater keg-collar case:
 *      the single circular label is on one page, Tesseract caught ABV
 *      there, so brand/GW VLM extraction routes to the same page).
 *   2. The first page whose render-kind tags it as a label.
 *   3. Fall back to the first page in render order if nothing above
 *      matches (single-page synthetic fixtures).
 *
 * This is a routing hint — not a location claim. The UI renders the
 * NoSourceOverlay for vlm-source bboxes; the page just determines which
 * tab to land on so the reviewer can see the label they're verifying.
 */
function pickVlmRoutingPage(
  bboxes: FieldBboxes,
  pages: Array<{ pageNumber: number; kind: RenderedPageKind }>,
): number {
  for (const bb of Object.values(bboxes)) {
    if (bb && bb.source === 'tesseract' && bb.words.length > 0) {
      const p = pages.find((pg) => pg.pageNumber === bb.page);
      if (p && p.kind.includes('label')) return bb.page;
    }
  }
  const firstLabel = pages.find((p) => p.kind.includes('label'));
  if (firstLabel) return firstLabel.pageNumber;
  return pages[0]?.pageNumber ?? 1;
}

/**
 * Form-side fallback targets: only the comparison-driving + display-critical
 * form fields. Used when the PDF text prepass cannot read a flattened form.
 */
async function runFormFallback(args: {
  application: ExtractedApplicationForm;
  bboxes: FieldBboxes;
  pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  fallback: VlmSingleFieldExtractor;
  trace?: ExtractorOptions['trace'];
}): Promise<FieldBboxes> {
  const { application, bboxes, pages, fallback, trace } = args;
  const updated: FieldBboxes = { ...bboxes };

  const formFallbackFields: FieldPath[] = [
    'application.brandName',
    'application.fancifulName',
    'application.source',
    'application.productType',
    'application.applicant.name',
  ];
  if (
    application.productType === 'WINE' ||
    application.grapeVarietals ||
    application.wineAppellation
  ) {
    formFallbackFields.push(
      'application.grapeVarietals',
      'application.wineAppellation',
    );
  }

  const targets: FieldPath[] = [];
  for (const field of formFallbackFields) {
    const existing = bboxes[field];
    const value = getApplicationField(application, field);
    if (shouldFallback(existing, value)) targets.push(field);
  }

  // Same queueing pattern as runLabelFallback. The fallback implementation
  // limits provider concurrency and retries 429s with backoff.
  const results = await Promise.all(
    targets.map(async (fieldPath) => ({
      fieldPath,
      value: await fallback.extractField({ fieldPath, pages, trace }),
    })),
  );
  for (const { fieldPath, value } of results) {
    if (value !== null) {
      setApplicationField(application, fieldPath, value);
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

function shouldFallbackGovernmentWarning(
  existing: FieldBbox | undefined,
  value: string | null,
): boolean {
  if (shouldFallback(existing, value)) return true;
  if (!value) return true;
  const normalized = normalizeWhitespace(value).toLowerCase();
  const canonical = normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL).toLowerCase();
  return normalized !== canonical;
}

function shouldApplyFallbackLabelValue(
  label: ExtractedFields,
  fieldPath: FieldPath,
  fallbackValue: string,
): boolean {
  if (
    fieldPath === 'label.wineVarietal' ||
    fieldPath === 'label.wineAppellation'
  ) {
    return normalizeLabelWineFieldValue(fieldPath, fallbackValue) !== null;
  }
  if (fieldPath === 'label.countryOfOrigin') {
    return normalizeLabelCountryOriginValue(fallbackValue) !== null;
  }

  if (fieldPath !== 'label.governmentWarning') return true;

  const existingText = label.governmentWarning.text;
  if (!existingText || existingText.trim().length === 0) return true;

  const existing = scoreGovernmentWarning(existingText);
  const candidate = scoreGovernmentWarning(fallbackValue);

  // A single-field VLM fallback can read tiny warning text well, but it can
  // also truncate to just one numbered sentence. Never let that downgrade a
  // Tesseract block that already carries the legal prefix + both sentence
  // anchors; preserve the OCR bbox and the more complete text.
  return candidate.score > existing.score;
}

function scoreGovernmentWarning(value: string): {
  score: number;
  hasLegalPrefix: boolean;
  hasSentence1: boolean;
  hasSentence2: boolean;
  isExactCanonical: boolean;
} {
  const normalized = normalizeWhitespace(value);
  const normalizedLower = normalized.toLowerCase();
  const canonicalLower = normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL).toLowerCase();
  const tokenSet = new Set(
    normalizedLower
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
  const hasPrefixWords = /\bgovernment\s+warning\b/i.test(normalized);
  const hasLegalPrefix = normalizedLower.includes(GOVERNMENT_WARNING_PREFIX.toLowerCase());
  const hasSentence1 = hasAnchorCoverage(tokenSet, GOVERNMENT_WARNING_SENTENCE_1_ANCHORS);
  const hasSentence2 = hasAnchorCoverage(tokenSet, GOVERNMENT_WARNING_SENTENCE_2_ANCHORS);
  const isExactCanonical = normalizedLower === canonicalLower;
  const score =
    (hasPrefixWords ? 1 : 0) +
    (hasLegalPrefix ? 1 : 0) +
    (hasSentence1 ? 2 : 0) +
    (hasSentence2 ? 2 : 0) +
    (isExactCanonical ? 1 : 0);
  return { score, hasLegalPrefix, hasSentence1, hasSentence2, isExactCanonical };
}

function hasAnchorCoverage(
  tokenSet: Set<string>,
  anchors: ReadonlyArray<string>,
): boolean {
  const matched = anchors.filter((anchor) => tokenSet.has(anchor)).length;
  return matched / anchors.length >= GOVERNMENT_WARNING_ANCHOR_THRESHOLD;
}

function applyFallbackLabelValue(
  label: ExtractedFields,
  fieldPath: FieldPath,
  value: string,
): void {
  const labelKey = stripLabelPrefix(fieldPath);
  if (labelKey === 'governmentWarning') {
    label.governmentWarning.text = value;
    return;
  }
  if (fieldPath === 'label.wineVarietal' || fieldPath === 'label.wineAppellation') {
    const normalized = normalizeLabelWineFieldValue(fieldPath, value);
    if (normalized === null) return;
    (label as Record<string, unknown>)[labelKey] = normalized;
    return;
  }
  if (fieldPath === 'label.countryOfOrigin') {
    const normalized = normalizeLabelCountryOriginValue(value);
    if (normalized === null) return;
    label.countryOfOrigin = normalized;
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

function cloneApplication(
  application: ExtractedApplicationForm,
): ExtractedApplicationForm {
  return {
    ...application,
    applicant: { ...application.applicant },
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
    const family = inferProductFamily(value);
    if (family !== null) application.productType = family;
    return;
  }
  if (key === 'source') {
    if (value.toLowerCase().startsWith('imp')) application.source = 'Imported';
    else application.source = 'Domestic';
    return;
  }
  if (key in application) {
    (application as Record<string, unknown>)[key] =
      key === 'grapeVarietals' || key === 'wineAppellation'
        ? nullableWineValue(value)
        : value;
  }
}

function normalizeWineOnlyFormFields(
  application: ExtractedApplicationForm,
  bboxes: FieldBboxes,
): void {
  application.grapeVarietals = nullableWineValue(application.grapeVarietals);
  application.wineAppellation = nullableWineValue(application.wineAppellation);

  if (application.productType === 'WINE') return;
  application.grapeVarietals = null;
  application.wineAppellation = null;
  delete bboxes['application.grapeVarietals'];
  delete bboxes['application.wineAppellation'];
}

function nullableWineValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  const normalized = value
    .trim()
    .replace(/[—–-]+/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (normalized === 'null') return null;
  if (
    normalized === '' ||
    normalized === '-' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'not applicable'
  ) {
    return 'N/A';
  }
  return trimmed;
}

function normalizeLabelWineFieldValue(
  fieldPath: FieldPath,
  value: string,
): string | null {
  const normalized = value
    .trim()
    .replace(/[—–-]+/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (
    normalized === '' ||
    normalized === '-' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'not applicable' ||
    normalized === 'null'
  ) {
    return null;
  }
  if (
    fieldPath === 'label.wineVarietal' &&
    isWineTypeOnly(value)
  ) {
    return null;
  }
  if (fieldPath === 'label.wineVarietal') {
    return canonicalWineVarietal(value);
  }
  if (fieldPath === 'label.wineAppellation') {
    const canonical = canonicalWineAppellation(value);
    if (canonical) return canonical;
    if (isWineTypeOnly(value)) return null;
  }
  return value.trim();
}

function normalizeLabelCountryOriginValue(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (
    normalized === '' ||
    normalized === 'null' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'not applicable' ||
    normalized === 'american' ||
    /\b(?:wine|blend|beer|ale|lager|vodka|whiskey|whisky|tequila|rum|gin|chardonnay|cabernet|merlot|pinot|sauvignon|riesling)\b/.test(
      normalized,
    )
  ) {
    return null;
  }
  return value.trim();
}

/**
 * Map a free-form value (TYPE OF PRODUCT row or CLASS/TYPE DESCRIPTION line)
 * to one of the three TTB product families. Returns null when the value
 * names multiple families (checkbox triplet row with no clear winner) so a
 * later landmark or the VLM fallback can disambiguate.
 */
function inferProductFamily(value: string): ProductFamily | null {
  const upper = value.toUpperCase();
  const wineHit = /\b(WINE|PORT|SHERRY|VERMOUTH|CHAMPAGNE|RIESLING|CHARDONNAY|CABERNET|MERLOT|PINOT|SAUVIGNON|MOSCATO|VINEYARD)\b/.test(upper);
  const maltHit = /\b(MALT|BEER|ALE|LAGER|STOUT|PORTER|IPA|PILSNER|WEISSE|SAISON)\b/.test(upper);
  const spiritsHit = /\b(SPIRITS|WHISKEY|WHISKY|VODKA|RUM|GIN|TEQUILA|BOURBON|BRANDY|COGNAC|MEZCAL|LIQUEUR|DISTILLED)\b/.test(upper);
  const families: Array<'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES'> = [];
  if (wineHit) families.push('WINE');
  if (maltHit) families.push('MALT BEVERAGES');
  if (spiritsHit) families.push('DISTILLED SPIRITS');
  if (families.length !== 1) return null;
  return families[0]!;
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

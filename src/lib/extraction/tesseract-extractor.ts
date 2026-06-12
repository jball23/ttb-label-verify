/**
 * Tesseract-first extractor with per-field GPT-4o fallback.
 *
 * Phase A split: the public `extract()` path is **label-only and sync**. It
 * runs label OCR in parallel via the worker pool, runs label-side assignment
 * (without depending on form-side data), runs VLM fallback for label fields
 * that Tesseract missed, and returns a document with a blank application
 * form. Cross-check + verdict downstream skips application comparison when
 * `application` is blank.
 *
 * Form-side OCR is exposed separately as `extractFormFields(formPage)`,
 * intended to be invoked by the Phase B async patch path. Splitting the two
 * lets the verdict ship in ~6s on Tesseract.js WASM (label pages only),
 * while the form-side cross-check patches in over polling once it finishes.
 *
 * Pipeline (sync path):
 *   1. Parallel OCR on every label page (`runOcr` via pool — Promise.all,
 *      KD7 promoted to a 2-slot pool in Phase A).
 *   2. Label assignment — LABEL_PATTERNS for ABV / net contents / producer
 *      / country + class type; GW canonical fuzzy match for the warning.
 *      The brand cross-reference is OPTIONAL — when `application.brandName`
 *      is unavailable (sync path) we skip it and let label.brandName fall
 *      to VLM. Phase B can re-run assignment once form data lands to
 *      upgrade label.brandName from VLM to a Tesseract bbox.
 *   3. VLM fallback for any label field where the assigner produced no
 *      words or meanConfidence < OCR_CONFIDENCE_THRESHOLD. Returns text
 *      only; bbox flagged unavailable.
 *
 * Plan unit: U4 (original) + Phase A (form/label split).
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
   * Sync label-only extraction. Pages may include the form page (it is
   * harmlessly ignored on this path); only label pages are OCR'd.
   *
   * U4 step 3 broadened DocumentExtractor.extract to take RenderedPage-shaped
   * input so kinds flow through to the field assigners.
   */
  async extract(pages: { pageNumber: number; kind: string; png: Buffer }[]): Promise<ExtractedDocument> {
    return this.extractFromPages(pages as RenderedPage[]);
  }

  /**
   * Internal entry point retained for direct tests that wire arbitrary pages.
   * Form pages in the input set are skipped on the sync path — call
   * `extractFormFields(formPage)` separately when form data is needed.
   */
  async extractFromPages(pages: RenderedPage[]): Promise<ExtractedDocument> {
    if (pages.length === 0) {
      throw new Error('TesseractExtractor.extractFromPages requires at least one page.');
    }

    // 1. OCR every label page IN PARALLEL via the pool. A typical COLA has
    //    3-4 label pages; with pool size 2 this halves wall-clock vs the
    //    pre-Phase-A sequential pass.
    const labelPages = pages.filter((p) => p.kind.includes('label'));
    const labelPageOcr = await runOcrPages(labelPages);

    // 2. Label assignment. We do NOT have form.brandName on the sync path,
    //    so the brand cross-reference inside assignLabelFields is a no-op
    //    here — label.brandName flows through to VLM fallback when no
    //    pattern catches it.
    const blank = blankApplication();
    const { label, labelBboxes } = assignLabelFields(labelPageOcr, blank);

    let bboxes: FieldBboxes = { ...labelBboxes };

    // 3. Fallback pass — label fields only on this path. Skip silently when
    //    no fallback is wired.
    if (this.fallback) {
      const fallbackPages = pages.map((p) => ({
        pageNumber: p.pageNumber,
        png: p.png,
        kind: p.kind,
      }));
      bboxes = await runLabelFallback({
        label,
        bboxes,
        pages: fallbackPages,
        fallback: this.fallback,
      });
    }

    return {
      application: blank,
      label,
      provenance: {},
      bboxes,
    };
  }

  /**
   * Phase B path: form-side extraction. Runs OCR on a single form page,
   * applies landmark-based assignment, and falls back to VLM for fields
   * the landmark loop missed. Returns the form fields + form-side bboxes
   * separately so the caller can patch them into the report once it's
   * computed.
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
    let formBboxes = assignFormFields(ocr, application);

    if (this.fallback) {
      formBboxes = await runFormFallback({
        application,
        bboxes: formBboxes,
        pages: [{ pageNumber: formPage.pageNumber, png: formPage.png, kind: formPage.kind }],
        fallback: this.fallback,
      });
    }
    return { application, formBboxes };
  }
}

/**
 * OCR a set of rendered pages concurrently. Pool size in
 * `src/lib/ocr/worker.ts` caps real parallelism — extra calls queue
 * automatically inside the pool.
 */
async function runOcrPages(pages: RenderedPage[]): Promise<PageOcr[]> {
  return Promise.all(
    pages.map(async (page) => {
      const result = await runOcr(page.png);
      return {
        pageNumber: page.pageNumber,
        kind: page.kind,
        words: result.words,
        meanConfidence: result.meanConfidence,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Form-side assigner (landmark-based with at-match bbox capture)
// ---------------------------------------------------------------------------

function assignFormFields(formPage: PageOcr, application: ExtractedApplicationForm): FieldBboxes {
  const formBboxes: FieldBboxes = {};
  for (const landmark of FORM_LANDMARKS) {
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
  return formBboxes;
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

// ---------------------------------------------------------------------------
// Label-side assigner (pattern + GW fuzzy match)
// ---------------------------------------------------------------------------

/**
 * Label-side assignment. Side-agnostic — every label.* field other than
 * `brandName` iterates all label pages with no front/back assumption.
 *
 * `brandName` keeps a soft cross-reference path: when `application.brandName`
 * is provided (Phase B re-run after form OCR), we fuzzy-find it on the
 * front-tagged pages. On the sync path `application.brandName` is null and
 * the cross-reference is skipped — label.brandName falls to VLM fallback.
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

  // 3a. Brand-name cross-reference (Phase B only). On the sync path
  // application.brandName is null, so this block no-ops and brandName flows
  // to VLM fallback. When form data lands, this can run a second time to
  // upgrade label.brandName from VLM to a Tesseract bbox.
  const frontPages = pages.filter((p) => p.kind.includes('front'));
  if (application.brandName && frontPages.length > 0) {
    let best: { page: PageOcr; words: WordRect[]; score: number } | null = null;
    for (const page of frontPages) {
      const candidate = findBrandMatch(application.brandName, page.words);
      if (candidate && (!best || candidate.score > best.score)) {
        best = { page, words: candidate.words, score: candidate.score };
      }
    }
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

  return { label, labelBboxes };
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
  const maxWindow = Math.min(brandTokens.length + 1, 5);
  let best: { start: number; end: number; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (cleanWords[i]!.length < 2) continue;
    for (let k = 1; k <= maxWindow && i + k <= words.length; k++) {
      const windowClean = cleanWords.slice(i, i + k).filter((t) => t.length >= 2);
      if (windowClean.length === 0) continue;
      let matched = 0;
      for (const wt of windowClean) {
        if (brandTokens.some((bt) => tokensSimilar(wt, bt))) matched++;
      }
      const score = matched / Math.max(windowClean.length, brandTokens.length);
      if (score >= 0.6 && (!best || score > best.score)) {
        best = { start: i, end: i + k, score };
      }
    }
  }
  if (!best) return null;
  return { words: words.slice(best.start, best.end), score: best.score };
}

function tokensSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  if (a.length >= 4 && b.length >= 4) {
    if (a.slice(0, 4) === b.slice(0, 4)) return true;
  }
  return false;
}

function findGovernmentWarning(page: PageOcr): {
  text: string;
  words: WordRect[];
  meanConfidence: number;
} | null {
  const prefixIdx = page.words.findIndex(
    (w, i) =>
      /^government$/i.test(w.text) &&
      /^warning/i.test(page.words[i + 1]?.text ?? ''),
  );
  if (prefixIdx === -1) return null;

  const canonicalTokens = new Set(
    normalizeWhitespace(GOVERNMENT_WARNING_CANONICAL)
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );

  const collected: WordRect[] = [];
  const window = page.words.slice(prefixIdx, prefixIdx + 130);
  for (const w of window) {
    const norm = w.text.toLowerCase().replace(/[^a-z]/g, '');
    if (norm.length === 0) continue;
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
  label: ExtractedFields;
  bboxes: FieldBboxes;
  pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  fallback: VlmSingleFieldExtractor;
}): Promise<FieldBboxes> {
  const { label, bboxes, pages, fallback } = args;
  const updated: FieldBboxes = { ...bboxes };

  const targets: FieldPath[] = [];

  // label.brandName has no regex — on the sync path it always falls back.
  if (shouldFallback(bboxes['label.brandName'], label.brandName)) {
    targets.push('label.brandName');
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

  // Dedup — LABEL_PATTERNS has multiple entries per field (e.g. ABV).
  const unique = Array.from(new Set(targets));

  // Fire every fallback call concurrently. Each VLM call is ~3-5s of
  // network-bound wait — at 3-4 targets per request, sequential fan-out
  // dominates the sync wall clock (Phase A latency profile). Parallel
  // pays the same token cost (no extra spend) for a 3-5× wall-clock win.
  // The OpenAI SDK is thread-safe and 4 concurrent calls comfortably fit
  // inside the standard tier's rate limits.
  const results = await Promise.all(
    unique.map(async (fieldPath) => ({
      fieldPath,
      value: await fallback.extractField({ fieldPath, pages }),
    })),
  );
  // Pick the page that's most likely to visually contain the field. VLM
  // doesn't return coordinates, so the page is a routing hint, not a
  // location claim — the UI renders NoSourceOverlay for vlm-source bboxes
  // and the user knows the exact spot is unknown.
  const vlmPage = pickVlmRoutingPage(updated, pages);
  for (const { fieldPath, value } of results) {
    if (value !== null) {
      applyFallbackLabelValue(label, fieldPath, value);
    }
    updated[fieldPath] = {
      page: vlmPage,
      source: 'vlm',
      words: [],
      meanConfidence: null,
    } satisfies FieldBbox;
  }
  return updated;
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
 * Form-side fallback targets: only the cross-check-driving + display-critical
 * form fields. Phase B path only.
 */
async function runFormFallback(args: {
  application: ExtractedApplicationForm;
  bboxes: FieldBboxes;
  pages: Array<{ pageNumber: number; png: Buffer; kind: RenderedPageKind }>;
  fallback: VlmSingleFieldExtractor;
}): Promise<FieldBboxes> {
  const { application, bboxes, pages, fallback } = args;
  const updated: FieldBboxes = { ...bboxes };

  const formFallbackFields: FieldPath[] = [
    'application.brandName',
    'application.fancifulName',
    'application.productType',
    'application.applicant.name',
    'application.grapeVarietals',
    'application.wineAppellation',
  ];

  const targets: FieldPath[] = [];
  for (const field of formFallbackFields) {
    const existing = bboxes[field];
    const value = getApplicationField(application, field);
    if (shouldFallback(existing, value)) targets.push(field);
  }

  // Same parallel fan-out as runLabelFallback — VLM calls are network-bound
  // and the OpenAI SDK handles concurrent traffic. Saves ~10s of wall clock
  // on a form with 4-6 fallback targets.
  const results = await Promise.all(
    targets.map(async (fieldPath) => ({
      fieldPath,
      value: await fallback.extractField({ fieldPath, pages }),
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
    (application as Record<string, unknown>)[key] = value;
  }
}

/**
 * Map a free-form value (TYPE OF PRODUCT row or CLASS/TYPE DESCRIPTION line)
 * to one of the three TTB product families. Returns null when the value
 * names multiple families (checkbox triplet row with no clear winner) so a
 * later landmark or the VLM fallback can disambiguate.
 */
function inferProductFamily(value: string): 'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES' | null {
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

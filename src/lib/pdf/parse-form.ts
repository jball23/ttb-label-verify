import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { RenderedPage } from './render';
import type {
  ExtractedApplicationForm,
  FieldBbox,
  FieldBboxes,
  FieldPath,
  ParsedApplicationFormPrepass,
  WordRect,
} from '../extraction/types';

const TARGET_DPI = 200;
const PDF_DEFAULT_DPI = 72;
const POINTS_TO_PIXELS = TARGET_DPI / PDF_DEFAULT_DPI;

type ProductFamily = 'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES';

interface PdfWord extends WordRect {
  pdf: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

interface PdfBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface BoxRead {
  text: string;
  words: PdfWord[];
  lines: Array<{ text: string; words: PdfWord[] }>;
}

const LEFT_COLUMN_X0 = 8;
const LEFT_HALF_COLUMN_X1 = 100;
const LEFT_FULL_COLUMN_X1 = 195;

const FORM_BOXES = {
  plantRegistryNumber: {
    x0: LEFT_COLUMN_X0,
    y0: 578,
    x1: LEFT_HALF_COLUMN_X1,
    y1: 602,
  },
  serialNumber: {
    x0: LEFT_COLUMN_X0,
    y0: 534,
    x1: LEFT_HALF_COLUMN_X1,
    y1: 556,
  },
  applicant: { x0: 200, y0: 536, x1: 590, y1: 596 },
  brandName: { x0: LEFT_COLUMN_X0, y0: 454, x1: LEFT_FULL_COLUMN_X1, y1: 470 },
  fancifulName: { x0: LEFT_COLUMN_X0, y0: 424, x1: LEFT_FULL_COLUMN_X1, y1: 440 },
} satisfies Record<string, PdfBox>;

export async function parseApplicationFormFromRenderedPages(
  pages: RenderedPage[],
): Promise<ParsedApplicationFormPrepass | null> {
  const formPage =
    pages.find((p) => p.kind.includes('form') && (p.textItems?.length ?? 0) > 0) ??
    null;
  if (!formPage || !formPage.pageWidth || !formPage.pageHeight) return null;

  const words = pdfWordsFromPage(formPage);
  if (words.length === 0) return null;
  if (!findMarkerRun(words, 'BRAND NAME') || !findMarkerRun(words, 'TYPE OF PRODUCT')) {
    return null;
  }

  const application = blankApplication();
  const bboxes: FieldBboxes = {};

  assignBoxField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.plantRegistryNumber',
    FORM_BOXES.plantRegistryNumber,
  );
  assignBoxField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.serialNumber',
    FORM_BOXES.serialNumber,
  );
  assignBoxField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.brandName',
    FORM_BOXES.brandName,
  );
  assignBoxField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.fancifulName',
    FORM_BOXES.fancifulName,
  );
  assignMarkerBelowField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.grapeVarietals',
    'GRAPE VARIETAL',
    { x0: 102, x1: 246 },
  );
  assignMarkerBelowField(
    application,
    bboxes,
    formPage.pageNumber,
    words,
    'application.wineAppellation',
    'WINE APPELLATION',
    { x0: 8, x1: 246 },
  );

  const imageContext = await createImageContext(formPage.png);
  const productType = readCheckedChoice<ProductFamily>({
    words,
    ctx: imageContext,
    marker: 'TYPE OF PRODUCT',
    choices: [
      { value: 'WINE', pattern: /\bWINE\b/ },
      { value: 'DISTILLED SPIRITS', pattern: /\bDISTILLED\s+SPIRITS\b/ },
      { value: 'MALT BEVERAGES', pattern: /\bMALT\s+BEVERAGES?\b/ },
    ],
  });
  if (productType) {
    application.productType = productType.value;
    bboxes['application.productType'] = bboxFromPdfWords(
      formPage.pageNumber,
      productType.words,
    );
  }

  const source = readCheckedChoice<'Domestic' | 'Imported'>({
    words,
    ctx: imageContext,
    marker: 'SOURCE OF',
    choices: [
      { value: 'Domestic', pattern: /\bDOMESTIC\b/ },
      { value: 'Imported', pattern: /\bIMPORTED\b/ },
    ],
  });
  if (source) {
    application.source = source.value;
    bboxes['application.source'] = bboxFromPdfWords(
      formPage.pageNumber,
      source.words,
    );
  }

  assignApplicant(application, bboxes, formPage.pageNumber, words);
  normalizeParsedForm(application, bboxes);

  if (!isUsableParsedForm(application)) return null;
  return { application, bboxes };
}

function blankApplication(): ExtractedApplicationForm {
  return {
    repId: null,
    plantRegistryNumber: null,
    source: null,
    serialNumber: null,
    productType: null,
    brandName: null,
    fancifulName: null,
    applicant: {
      name: null,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    },
    mailingAddress: null,
    formula: null,
    grapeVarietals: null,
    wineAppellation: null,
    phone: null,
    email: null,
    applicationType: 'CERTIFICATE_OF_LABEL_APPROVAL',
    containerWording: null,
    applicationDate: null,
    applicantSignatureName: null,
  };
}

function pdfWordsFromPage(page: RenderedPage): PdfWord[] {
  const pageHeight = page.pageHeight ?? 792;
  const words: PdfWord[] = [];
  for (const item of page.textItems ?? []) {
    const parts = Array.from(item.text.matchAll(/\S+/g));
    if (parts.length === 0) continue;
    const denominator = Math.max(item.text.length, 1);
    for (const part of parts) {
      const token = part[0];
      const start = part.index ?? 0;
      const end = start + token.length;
      const x0 = item.x + item.width * (start / denominator);
      const x1 = item.x + item.width * (end / denominator);
      const y0 = item.y;
      const y1 = item.y + item.height;
      words.push({
        text: token,
        confidence: 100,
        pdf: { x0, y0, x1, y1 },
        bbox: {
          x0: x0 * POINTS_TO_PIXELS,
          y0: (pageHeight - y1) * POINTS_TO_PIXELS,
          x1: x1 * POINTS_TO_PIXELS,
          y1: (pageHeight - y0) * POINTS_TO_PIXELS,
        },
      });
    }
  }
  return words;
}

function assignBoxField(
  application: ExtractedApplicationForm,
  bboxes: FieldBboxes,
  pageNumber: number,
  words: PdfWord[],
  field: FieldPath,
  box: PdfBox,
): void {
  const read = readBox(words, box);
  if (!read) return;
  const value = cleanFormValue(read.text);
  if (!value || isFormSectionHeader(value)) return;
  setApplicationField(application, field, value);
  bboxes[field] = bboxFromPdfWords(pageNumber, read.words);
}

function assignMarkerBelowField(
  application: ExtractedApplicationForm,
  bboxes: FieldBboxes,
  pageNumber: number,
  words: PdfWord[],
  field: FieldPath,
  marker: string,
  xRange: { x0: number; x1: number },
): void {
  const markerRun = findMarkerRun(words, marker);
  if (!markerRun) return;
  const markerCenterY = (markerRun.start.pdf.y0 + markerRun.end.pdf.y1) / 2;
  const candidates = words.filter((word) => {
    const cx = (word.pdf.x0 + word.pdf.x1) / 2;
    const cy = (word.pdf.y0 + word.pdf.y1) / 2;
    return (
      cx >= xRange.x0 &&
      cx <= xRange.x1 &&
      cy < markerCenterY - 3 &&
      markerCenterY - cy <= 30
    );
  });
  if (candidates.length === 0) return;
  const [firstLine] = groupPdfLines(candidates);
  if (!firstLine || firstLine.length === 0) return;
  const value = cleanFormValue(firstLine.map((word) => word.text).join(' '));
  if (!value || isFormSectionHeader(value)) return;
  setApplicationField(application, field, value);
  bboxes[field] = bboxFromPdfWords(pageNumber, firstLine);
}

function readBox(words: PdfWord[], box: PdfBox): BoxRead | null {
  const selected = words.filter((word) => {
    const cx = (word.pdf.x0 + word.pdf.x1) / 2;
    const cy = (word.pdf.y0 + word.pdf.y1) / 2;
    return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1;
  });
  if (selected.length === 0) return null;
  const lines = groupPdfLines(selected).map((lineWords) => ({
    words: lineWords,
    text: cleanFormValue(lineWords.map((word) => word.text).join(' ')),
  })).filter((line) => line.text.length > 0);
  if (lines.length === 0) return null;
  return {
    text: lines.map((line) => line.text).join(' '),
    words: lines.flatMap((line) => line.words),
    lines,
  };
}

function groupPdfLines(words: PdfWord[]): PdfWord[][] {
  const sorted = [...words].sort(
    (a, b) =>
      (b.pdf.y0 + b.pdf.y1) / 2 - (a.pdf.y0 + a.pdf.y1) / 2 ||
      a.pdf.x0 - b.pdf.x0,
  );
  const lines: Array<{ centerY: number; words: PdfWord[] }> = [];
  for (const word of sorted) {
    const centerY = (word.pdf.y0 + word.pdf.y1) / 2;
    const line = lines.find((candidate) => Math.abs(candidate.centerY - centerY) <= 3);
    if (line) {
      line.words.push(word);
      line.centerY =
        line.words.reduce((sum, w) => sum + (w.pdf.y0 + w.pdf.y1) / 2, 0) /
        line.words.length;
    } else {
      lines.push({ centerY, words: [word] });
    }
  }
  return lines
    .sort((a, b) => b.centerY - a.centerY)
    .map((line) => line.words.sort((a, b) => a.pdf.x0 - b.pdf.x0));
}

async function createImageContext(png: Buffer): Promise<SKRSContext2D> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx;
}

function readCheckedChoice<T extends string>(args: {
  words: PdfWord[];
  ctx: SKRSContext2D;
  marker: string;
  choices: Array<{ value: T; pattern: RegExp }>;
}): { value: T; words: PdfWord[] } | null {
  const rows = findChoiceRows(args.words, args.marker, args.choices);
  if (rows.length < 2) return null;
  const scored = rows
    .map((row) => ({ ...row, score: scoreCheckboxLeftOfWords(args.ctx, row.words) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const second = scored[1]?.score ?? 0;
  if (best.score < 15_000 || best.score < second * 1.45) return null;
  return { value: best.value, words: best.words };
}

function findChoiceRows<T extends string>(
  words: PdfWord[],
  marker: string,
  choices: Array<{ value: T; pattern: RegExp }>,
): Array<{ value: T; words: PdfWord[] }> {
  const markerRun = findMarkerRun(words, marker);
  if (!markerRun) return [];
  const optionWords = words
    .filter(
      (word) =>
        word.bbox.y0 > markerRun.end.bbox.y1 &&
        word.bbox.y0 - markerRun.end.bbox.y1 < 220 &&
        word.bbox.x0 > markerRun.start.bbox.x0 - 40 &&
        word.bbox.x0 < markerRun.end.bbox.x1 + 260,
    )
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  const lines: PdfWord[][] = [];
  for (const word of optionWords) {
    const line = lines.find(
      (candidate) => Math.abs(candidate[0]!.bbox.y0 - word.bbox.y0) < 18,
    );
    if (line) line.push(word);
    else lines.push([word]);
  }

  const rows: Array<{ value: T; words: PdfWord[] }> = [];
  for (const line of lines) {
    const text = line
      .map((word) => word.text)
      .join(' ')
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const match = choices.find((choice) => choice.pattern.test(text));
    if (match) rows.push({ value: match.value, words: line });
  }
  return rows;
}

function scoreCheckboxLeftOfWords(ctx: SKRSContext2D, words: PdfWord[]): number {
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

function findMarkerRun(
  words: PdfWord[],
  marker: string,
): { start: PdfWord; end: PdfWord } | null {
  const markerTokens = marker
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  for (let i = 0; i <= sorted.length - markerTokens.length; i++) {
    let ok = true;
    for (let k = 0; k < markerTokens.length; k++) {
      const wordText =
        sorted[i + k]?.text.toLowerCase().replace(/[:.,]+$/, '') ?? '';
      if (!wordText.includes(markerTokens[k]!)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return {
        start: sorted[i]!,
        end: sorted[i + markerTokens.length - 1]!,
      };
    }
  }
  return null;
}

function assignApplicant(
  application: ExtractedApplicationForm,
  bboxes: FieldBboxes,
  pageNumber: number,
  words: PdfWord[],
): void {
  const read = readBox(words, FORM_BOXES.applicant);
  if (!read) return;
  const lines = read.lines
    .map((line) => ({
      text: cleanApplicantLine(line.text),
      words: line.words,
    }))
    .filter(
      (line) =>
        line.text.length > 0 &&
        !/(basic permit|brewer'?s notice|plant registry|approved dba|tradename|required)/i.test(
          line.text,
        ),
    );
  if (lines.length === 0) return;

  const usedOnLabelLine =
    lines.find((line) => /\bused\s+on\s+label\b/i.test(line.text)) ?? null;
  const nameLine = usedOnLabelLine ?? lines[0]!;
  const nameWords = nameLine.words.filter(
    (word) => !/^\(?(?:used|on|label)\)?$/i.test(word.text),
  );
  const name = cleanApplicantLine(
    nameLine.text.replace(/\(?\s*used\s+on\s+label\s*\)?/i, ''),
  );
  if (name) {
    application.applicant.name = name;
    bboxes['application.applicant.name'] = bboxFromPdfWords(pageNumber, nameWords);
  }

  const addressLine =
    lines.find((line) => /^\d+\b/.test(line.text) && !/\bused\s+on\s+label\b/i.test(line.text)) ??
    null;
  if (addressLine) {
    application.applicant.addressLine1 = addressLine.text;
    bboxes['application.applicant.address'] = bboxFromPdfWords(
      pageNumber,
      addressLine.words,
    );
  }

  const cityStateLine = lines.find((line) => parseCityStateZip(line.text) !== null) ?? null;
  const cityState = cityStateLine ? parseCityStateZip(cityStateLine.text) : null;
  if (cityState && cityStateLine) {
    application.applicant.city = cityState.city;
    application.applicant.state = cityState.state;
    application.applicant.postalCode = cityState.postalCode;
    const bbox = bboxFromPdfWords(pageNumber, cityStateLine.words);
    bboxes['application.applicant.city'] = bbox;
    bboxes['application.applicant.state'] = bbox;
  }
}

function normalizeParsedForm(
  application: ExtractedApplicationForm,
  bboxes: FieldBboxes,
): void {
  const nullableFields: Array<{
    key: keyof Pick<
      ExtractedApplicationForm,
      | 'brandName'
      | 'fancifulName'
      | 'formula'
      | 'grapeVarietals'
      | 'wineAppellation'
      | 'phone'
      | 'email'
      | 'containerWording'
      | 'applicationDate'
      | 'applicantSignatureName'
    >;
    path: FieldPath;
  }> = [
    { key: 'brandName', path: 'application.brandName' },
    { key: 'fancifulName', path: 'application.fancifulName' },
    { key: 'formula', path: 'application.formula' },
    { key: 'grapeVarietals', path: 'application.grapeVarietals' },
    { key: 'wineAppellation', path: 'application.wineAppellation' },
    { key: 'phone', path: 'application.phone' },
    { key: 'email', path: 'application.email' },
    { key: 'containerWording', path: 'application.containerWording' },
    { key: 'applicationDate', path: 'application.applicationDate' },
    { key: 'applicantSignatureName', path: 'application.applicantSignatureName' },
  ];

  for (const field of nullableFields) {
    const value = application[field.key];
    if (isBlankOrNa(value)) {
      application[field.key] = null;
      delete bboxes[field.path];
    }
  }

  if (application.productType !== 'WINE') {
    application.grapeVarietals = null;
    application.wineAppellation = null;
    delete bboxes['application.grapeVarietals'];
    delete bboxes['application.wineAppellation'];
  }
}

function isUsableParsedForm(application: ExtractedApplicationForm): boolean {
  return Boolean(
    application.brandName &&
      application.productType &&
      application.source &&
      application.applicant.name,
  );
}

function isBlankOrNa(value: string | null): boolean {
  if (!value) return true;
  return /^(?:n\/?a|none|null|-+|—+)$/i.test(value.trim());
}

function isFormSectionHeader(value: string): boolean {
  return /^\d+[a-z]?\.\s+/i.test(value) ||
    /\b(?:formula|grape varietal|type of application|phone number|email address|show any information)\b/i.test(
      value,
    );
}

function cleanFormValue(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

function cleanApplicantLine(value: string): string {
  return cleanFormValue(value)
    .replace(/\s+\(/g, ' (')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseCityStateZip(value: string): {
  city: string;
  state: string;
  postalCode: string | null;
} | null {
  const match = cleanApplicantLine(value).match(
    /^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)?$/i,
  );
  if (!match) return null;
  return {
    city: match[1]!.trim(),
    state: match[2]!.toUpperCase(),
    postalCode: match[3] ?? null,
  };
}

function setApplicationField(
  application: ExtractedApplicationForm,
  field: FieldPath,
  value: string,
): void {
  switch (field) {
    case 'application.plantRegistryNumber':
      application.plantRegistryNumber = value;
      return;
    case 'application.serialNumber':
      application.serialNumber = value;
      return;
    case 'application.brandName':
      application.brandName = value;
      return;
    case 'application.fancifulName':
      application.fancifulName = value;
      return;
    case 'application.formula':
      application.formula = value;
      return;
    case 'application.grapeVarietals':
      application.grapeVarietals = value;
      return;
    case 'application.wineAppellation':
      application.wineAppellation = value;
      return;
    case 'application.phone':
      application.phone = value;
      return;
    case 'application.email':
      application.email = value;
      return;
    case 'application.containerWording':
      application.containerWording = value;
      return;
    case 'application.applicationDate':
      application.applicationDate = value;
      return;
    case 'application.applicantSignatureName':
      application.applicantSignatureName = value;
      return;
    default:
      return;
  }
}

function bboxFromPdfWords(page: number, words: PdfWord[]): FieldBbox {
  return {
    page,
    source: 'pdf',
    words: words.map(({ text, confidence, bbox }) => ({ text, confidence, bbox })),
    meanConfidence: 100,
  };
}

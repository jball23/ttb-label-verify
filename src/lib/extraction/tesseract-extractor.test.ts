import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TesseractExtractor,
  __tesseractExtractorTesting,
  type VlmSingleFieldExtractor,
} from './tesseract-extractor';
import type { ExtractedApplicationForm, FieldBbox, FieldBboxes } from './types';
import { renderApplicationPages } from '../pdf/render';
import { getWorker, resetWorkerForTesting, type WordRect } from '../ocr/worker';

/**
 * Integration tests against real cola PDFs from the U2 spike. The Tesseract
 * worker is real (no mocks) — these prove the full OCR + assignment pipeline.
 * Each test takes ~3-8s; the suite times out generously.
 */

const COLA_BOUCHARD = path.resolve(
  __dirname,
  '../../../public/samples/cola/26086001000651-bouchard-aine-fils.pdf',
);
const COLA_COUNTRY_WESTERN = path.resolve(
  __dirname,
  '../../../public/samples/cola/26069001000588-country-and-western-ale.pdf',
);
const COLA_SOPLICA_APRICOT = path.resolve(
  __dirname,
  '../../../public/samples/cola/26062001000676-soplica-apricot.pdf',
);
const COLA_CHATEAU_SAINTE_GENEVIEVE = path.resolve(
  __dirname,
  '../../../public/samples/cola/26091001000783-chateau-sainte-genevieve.pdf',
);

function wordsFromLines(lines: string[]): WordRect[] {
  const words: WordRect[] = [];
  let y = 100;
  for (const line of lines) {
    let x = 260;
    for (const text of line.split(/\s+/)) {
      const width = Math.max(18, text.length * 7);
      words.push({
        text,
        confidence: 95,
        bbox: { x0: x, y0: y, x1: x + width, y1: y + 16 },
      });
      x += width + 7;
    }
    y += 28;
  }
  return words;
}

describe('tesseract-extractor (integration against real cola)', () => {
  afterAll(async () => {
    const worker = await getWorker().catch(() => null);
    if (worker) await worker.terminate();
    resetWorkerForTesting();
  });

  it('Item 8 applicant parser skips boilerplate and prefers DBA used on label', () => {
    const block = __tesseractExtractorTesting.readApplicantValueBlock(
      wordsFromLines([
        '8. NAME AND ADDRESS OF APPLICANT AS SHOWN ON PLANT REGISTRY,',
        "BASIC PERMIT OR BREWER'S NOTICE. INCLUDE APPROVED DBA OR",
        'TRADENAME IF USED ON LABEL (Required)',
        'PUB DOG BREWING COMPANY, THE D.O.G. BEVERAGE COMPANY, INC.',
        '1203 NEW WINDSOR RD',
        'WESTMINSTER MD 21158',
        'TWELVE PERCENT (Used on label)',
        '8a. MAILING ADDRESS, IF DIFFERENT',
      ]),
    );

    expect(block).toMatchObject({
      name: 'TWELVE PERCENT',
      addressLine1: '1203 NEW WINDSOR RD',
      city: 'WESTMINSTER',
      state: 'MD',
      postalCode: '21158',
    });
    expect(block?.nameWords.map((w) => w.text).join(' ')).toBe('TWELVE PERCENT');
  });

  it('matches label brand on non-front label pages when the classifier tags the art as back', () => {
    const best = __tesseractExtractorTesting.findBestBrandMatch(
      [
        {
          pageNumber: 2,
          kind: 'label-front',
          png: Buffer.from([]),
          words: wordsFromLines(['FOR TTB USE ONLY']),
          meanConfidence: 95,
        },
        {
          pageNumber: 3,
          kind: 'label-back',
          png: Buffer.from([]),
          words: wordsFromLines(['Stillwater Artisanal', 'Debutante']),
          meanConfidence: 95,
        },
      ],
      'STILLWATER ARTISANAL',
    );

    expect(best).not.toBeNull();
    expect(best?.page.pageNumber).toBe(3);
    expect(best?.words.map((word) => word.text)).toEqual(['Stillwater', 'Artisanal']);
  });

  it('matches brand when OCR glues multiple brand words into one token', () => {
    const match = __tesseractExtractorTesting.findBrandMatch(
      'STILLWATER ARTISANAL',
      wordsFromLines(['StillwaterArtisanal']),
    );

    expect(match).not.toBeNull();
    expect(match?.words.map((word) => word.text)).toEqual(['StillwaterArtisanal']);
  });

  it('does not match a brand to a short COLA chrome substring', () => {
    const match = __tesseractExtractorTesting.findBrandMatch(
      'LAYBACK',
      wordsFromLines(['Image Type:', 'Back']),
    );

    expect(match).toBeNull();
  });

  it('normalizes label wine fallback values through the wine lexicon', () => {
    expect(
      __tesseractExtractorTesting.normalizeLabelWineFieldValue(
        'label.wineVarietal',
        'white wine blend',
      ),
    ).toBeNull();
    expect(
      __tesseractExtractorTesting.normalizeLabelWineFieldValue(
        'label.wineVarietal',
        'Pinot Grigio',
      ),
    ).toBe('Pinot Gris');
    expect(
      __tesseractExtractorTesting.normalizeLabelWineFieldValue(
        'label.wineAppellation',
        'American White Wine',
      ),
    ).toBe('American');
  });

  it('narrows inferred wine appellation bboxes to the matching word', () => {
    const sourceBbox: FieldBbox = {
      page: 2,
      source: 'tesseract',
      words: wordsFromLines([
        'Produced and Bottled by CHATEAU SAINTE GENEVIEVE Bloomsdale Missouri American White Wine 2025 www.chateaustegen.com',
      ]),
      meanConfidence: 95,
    };

    const narrowed = __tesseractExtractorTesting.bboxForLexiconMatches(
      sourceBbox,
      ['American'],
    );

    expect(narrowed).not.toBeNull();
    expect(narrowed?.page).toBe(2);
    expect(narrowed?.source).toBe('tesseract');
    expect(narrowed?.words.map((word) => word.text)).toEqual(['American']);
  });

  it('uses parsed PDF form data without OCRing the form page', async () => {
    const application: ExtractedApplicationForm = {
      repId: null,
      plantRegistryNumber: 'BWN-MO-21189',
      source: 'Domestic',
      serialNumber: '260005',
      productType: 'WINE',
      brandName: 'CHATEAU SAINTE GENEVIEVE',
      fancifulName: 'HOMESTEAD HARVEST',
      applicant: {
        name: 'CHATEAU SAINTE GENEVIEVE',
        addressLine1: '8921 JACKSON SCHOOL RD',
        city: 'Bloomsdale',
        state: 'MO',
        postalCode: '63627',
      },
      mailingAddress: null,
      formula: null,
      grapeVarietals: null,
      wineAppellation: 'AMERICAN',
      phone: null,
      email: null,
      applicationType: 'CERTIFICATE_OF_LABEL_APPROVAL',
      containerWording: null,
      applicationDate: null,
      applicantSignatureName: null,
    };
    const word: WordRect = {
      text: 'CHATEAU',
      confidence: 100,
      bbox: { x0: 1, y0: 1, x1: 20, y1: 10 },
    };
    const bboxes: FieldBboxes = {
      'application.brandName': {
        page: 1,
        source: 'pdf',
        words: [word],
        meanConfidence: 100,
      },
    };

    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(
      [{ pageNumber: 1, kind: 'form', png: Buffer.from('not a png') }],
      { parsedForm: { application, bboxes } },
    );

    expect(result.application.brandName).toBe('CHATEAU SAINTE GENEVIEVE');
    expect(result.application.wineAppellation).toBe('AMERICAN');
    expect(result.bboxes?.['application.brandName']?.source).toBe('pdf');
  });

  it('Bouchard — extracts Government Warning + ABV + producer + country', async () => {
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    expect(result).toBeDefined();
    expect(result.application).toBeDefined();
    expect(result.label).toBeDefined();
    expect(result.bboxes).toBeDefined();
    expect(result.application.brandName).toBeTruthy();
    expect(result.application.brandName?.toLowerCase()).toMatch(/bouchard/);

    // The back label is page 4 in Bouchard. It carries the canonical GW;
    // Tesseract reads it at conf ~86 in the U2 spike. Match via the
    // 'government' + 'warning' prefix (the OCR'd text has spacing /
    // punctuation drift from canonical that's irrelevant for parity).
    expect(result.label.governmentWarning.text).toBeTruthy();
    expect(result.label.governmentWarning.text?.toLowerCase()).toMatch(/government.*warning/);

    // ABV — "12.6%" is on the back label.
    expect(result.label.abv).toBeTruthy();
    expect(result.label.abv).toMatch(/\b12\.6\s*%/);

    // Producer attribution — "IMPORTED BY" on the back label.
    expect(result.label.producer).toBeTruthy();
    expect(result.label.producer?.toLowerCase()).toMatch(/imported\s+by/);

    // Country of origin — "PRODUCT OF FRANCE" on the back label.
    expect(result.label.countryOfOrigin).toBeTruthy();
    expect(result.label.countryOfOrigin?.toLowerCase()).toMatch(/product\s+of/);
  }, 60_000);

  it('Soplica — reads distilled spirits checkbox and suppresses wine-only fields', async () => {
    const pdf = await readFile(COLA_SOPLICA_APRICOT);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    expect(result.application.productType).toBe('DISTILLED SPIRITS');
    expect(result.application.grapeVarietals).toBeNull();
    expect(result.application.wineAppellation).toBeNull();
    expect(result.bboxes?.['application.productType']?.source).toBe('tesseract');
    expect(result.bboxes?.['application.grapeVarietals']).toBeUndefined();
    expect(result.bboxes?.['application.wineAppellation']).toBeUndefined();
  }, 60_000);

  it('Bouchard — populates bboxes sidecar for matched fields', async () => {
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    // GW bbox: tesseract source, multiple words on page 4, mean conf 80+.
    const gwBbox = result.bboxes?.['label.governmentWarning'];
    expect(gwBbox).toBeDefined();
    expect(gwBbox?.source).toBe('tesseract');
    expect(gwBbox?.words.length).toBeGreaterThan(5);
    expect(gwBbox?.page).toBe(4);
    expect(gwBbox?.meanConfidence).toBeGreaterThan(70);

    // ABV bbox.
    const abvBbox = result.bboxes?.['label.abv'];
    expect(abvBbox).toBeDefined();
    expect(abvBbox?.source).toBe('tesseract');

    // Form-side bbox: same sync extraction response now carries application
    // evidence too, so the detail page can highlight app-vs-label values
    // without waiting for a separate patch phase.
    const appBrandBbox = result.bboxes?.['application.brandName'];
    expect(appBrandBbox).toBeDefined();
    expect(appBrandBbox?.source).toBe('tesseract');
    expect(appBrandBbox?.page).toBe(1);
  }, 60_000);

  it('Chateau Sainte Genevieve — keeps Government Warning valid when OCR misses the heading text', async () => {
    const pdf = await readFile(COLA_CHATEAU_SAINTE_GENEVIEVE);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    expect(result.label.governmentWarning.text).toMatch(/^GOVERNMENT WARNING:/);
    expect(result.label.governmentWarning.text).toContain(
      'According to the Surgeon General',
    );
    expect(result.label.governmentWarning.text).toContain(
      'Consumption of alcoholic beverages impairs',
    );
    expect(result.bboxes?.['label.governmentWarning']?.source).toBe('tesseract');
    expect(result.bboxes?.['label.governmentWarning']?.page).toBe(2);
  }, 60_000);

  it('VLM fallback fires for fields Tesseract did not find', async () => {
    // Use a stub fallback that records which fields were requested.
    const requested: string[] = [];
    const stub: VlmSingleFieldExtractor = {
      async extractField({ fieldPath }) {
        requested.push(fieldPath);
        return 'STUB-FALLBACK-VALUE';
      },
    };
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor({ vlmFallback: stub });
    const result = await extractor.extractFromPages(pages);

    // Tesseract should NOT have produced a brand name for the back-label-
    // dominant Bouchard (no 'front' page tagged in this fixture has a
    // clear brand wordmark). Fallback should fire for at least some fields.
    expect(requested.length).toBeGreaterThan(0);
    expect(requested).toContain('label.governmentWarning');
    expect(result.label.governmentWarning.text).not.toBe('STUB-FALLBACK-VALUE');
    expect(result.label.governmentWarning.text?.toLowerCase()).toContain('government warning');

    // Fields with no OCR location are marked source: 'vlm' with no bbox.
    // Government Warning is special: OCR reliably locates the warning block
    // but can misread dense small print, so fallback improves the text while
    // preserving the Tesseract word rectangles for highlighting.
    for (const fieldPath of requested) {
      const bbox = result.bboxes?.[fieldPath as keyof NonNullable<typeof result.bboxes>];
      if (fieldPath === 'label.governmentWarning' && bbox?.source === 'tesseract') {
        expect(bbox.words.length).toBeGreaterThan(5);
      } else {
        expect(bbox?.source).toBe('vlm');
        expect(bbox?.words).toEqual([]);
        expect(bbox?.meanConfidence).toBeNull();
      }
    }
  }, 60_000);

  it('Country & Western — Government Warning bbox excludes neighboring tapping text', async () => {
    const pdf = await readFile(COLA_COUNTRY_WESTERN);
    const pages = await renderApplicationPages(pdf);
    const extractor = new TesseractExtractor();
    const result = await extractor.extractFromPages(pages);

    const gwText = result.label.governmentWarning.text ?? '';
    expect(gwText.toLowerCase()).toContain('government warning');
    expect(gwText.toLowerCase()).not.toMatch(/consult|tapping|rupture/);
    expect(result.label.classType ?? '').not.toMatch(
      /keg collar|brand \(front\)|brewing|ale rd|country.*india pale|beer:\s*style/i,
    );

    const gwBbox = result.bboxes?.['label.governmentWarning'];
    expect(gwBbox).toBeDefined();
    expect(gwBbox?.source).toBe('tesseract');
    const highlightedText = gwBbox?.words.map((w) => w.text).join(' ') ?? '';
    expect(highlightedText.toLowerCase()).not.toMatch(/consult|tapping|rupture/);
  }, 60_000);
});

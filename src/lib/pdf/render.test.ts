import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PdfRenderError, __renderTesting, renderApplicationPages } from './render';

const SCENARIO_PDF = path.resolve(
  __dirname,
  '../../../public/samples/applications/01-ridge-creek-bourbon/application.pdf',
);

const COLA_BOUCHARD = path.resolve(
  __dirname,
  '../../../public/samples/cola/26086001000651-bouchard-aine-fils.pdf',
);

const COLA_CHACEWATER = path.resolve(
  __dirname,
  '../../../public/samples/cola/26083001000522-chacewater.pdf',
);

describe('renderApplicationPages', () => {
  it('renders a known single-page scenario PDF to one PNG with PNG magic bytes', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const pages = await renderApplicationPages(pdf);
    expect(pages).toHaveLength(1);
    const png = pages[0]!.png;
    expect(png).toBeInstanceOf(Buffer);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it('returns a reasonably-sized PNG for a 200 DPI letter page', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const pages = await renderApplicationPages(pdf);
    expect(pages[0]!.png.length).toBeGreaterThan(50 * 1024);
  });

  it('classifies the single-page synthetic fixture as form+label', async () => {
    // U11: with no marker pages and no separate label pages, the form page
    // also holds the label. Keep the label side neutral; the verifier scans
    // the actual evidence page instead of inferring front/back.
    const pdf = await readFile(SCENARIO_PDF);
    const pages = await renderApplicationPages(pdf);
    expect(pages[0]!.pageNumber).toBe(1);
    expect(pages[0]!.kind).toBe('form+label');
  });

  it('produces deterministic dimensions for the same input', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const [a, b] = await Promise.all([
      renderApplicationPages(pdf),
      renderApplicationPages(pdf),
    ]);
    expect(a[0]!.png.length).toBe(b[0]!.png.length);
  });

  it('throws PdfRenderError on empty input', async () => {
    await expect(renderApplicationPages(Buffer.alloc(0))).rejects.toBeInstanceOf(
      PdfRenderError,
    );
  });

  it('throws PdfRenderError on garbage input', async () => {
    await expect(
      renderApplicationPages(Buffer.from('not a pdf')),
    ).rejects.toBeInstanceOf(PdfRenderError);
  });

  // --- Label image tagging on real cola fixtures ---

  it('does not call a small chrome image a label page', () => {
    const picked = __renderTesting.pickPagesToRender([
      pageClass({ pageNumber: 1, formMarkerHits: 4, nonEmptyTextItems: 200 }),
      pageClass({
        pageNumber: 2,
        hasLabelMarker: true,
        hasImageContent: true,
        hasLabelImageContent: false,
        nonEmptyTextItems: 5,
      }),
      pageClass({
        pageNumber: 3,
        hasImageContent: true,
        hasLabelImageContent: true,
        nonEmptyTextItems: 5,
      }),
    ]);

    expect(picked).toContainEqual({ pageNumber: 1, kind: 'form' });
    expect(picked).not.toContainEqual({ pageNumber: 2, kind: 'label' });
    expect(picked).toContainEqual({ pageNumber: 3, kind: 'label' });
  });

  it('keeps label-image pages neutral even when marker text says front', () => {
    const picked = __renderTesting.pickPagesToRender([
      pageClass({ pageNumber: 1, formMarkerHits: 5, nonEmptyTextItems: 220 }),
      pageClass({
        pageNumber: 2,
        frontMarkerHits: 1,
        hasImageContent: true,
        hasLabelImageContent: true,
        nonEmptyTextItems: 120,
      }),
    ]);

    expect(picked).toContainEqual({ pageNumber: 1, kind: 'form' });
    expect(picked).not.toContainEqual({ pageNumber: 2, kind: 'label-front' });
    expect(picked).toContainEqual({ pageNumber: 2, kind: 'label' });
  });

  it('Bouchard — renders label-image pages without assigning sides', async () => {
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const tagged = pages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind }));
    expect(tagged).toContainEqual({ pageNumber: 1, kind: 'form' });
    expect(tagged).toContainEqual({ pageNumber: 2, kind: 'label' });
    expect(tagged).toContainEqual({ pageNumber: 3, kind: 'label' });
    expect(tagged.some((page) => /front|back/.test(page.kind))).toBe(false);
    for (const page of pages.filter((p) => p.kind.includes('label'))) {
      expect(page.labelImageRegions?.length).toBeGreaterThan(0);
      expect(page.ocrPng?.length).toBeGreaterThan(0);
      expect(page.ocrPng).not.toEqual(page.png);
    }
  });

  it('U11: tags Chacewater pages — form on 1, label on 3 via continuation heuristic', async () => {
    // Chacewater is the sparse-back-label case from the spike. Page 3 has
    // <30 words but carries the artwork as image XObjects. The classifier's
    // continuation-label heuristic (low text + image content + no marker)
    // tags it as neutral label artwork so the source viewer still surfaces
    // it without inventing a front/back side.
    const pdf = await readFile(COLA_CHACEWATER);
    const pages = await renderApplicationPages(pdf);
    const tagged = pages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind }));
    expect(tagged).toContainEqual({ pageNumber: 1, kind: 'form' });
    // Page 2 carries the markers but the next page (3) is the artwork. The
    // explicit assertion: page 3 is some flavour of label tag.
    const page3 = tagged.find((p) => p.pageNumber === 3);
    expect(page3).toBeDefined();
    expect(page3!.kind).toMatch(/^label/);
  });
});

function pageClass(
  overrides: Partial<Parameters<typeof __renderTesting.pickPagesToRender>[0][number]>,
): Parameters<typeof __renderTesting.pickPagesToRender>[0][number] {
  return {
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    textItems: [],
    formMarkerHits: 0,
    hasLabelMarker: false,
    frontMarkerHits: 0,
    backMarkerHits: 0,
    nonEmptyTextItems: 0,
    hasImageContent: false,
    hasLabelImageContent: false,
    largestImageArea: 0,
    labelImageRegions: [],
    ...overrides,
  };
}

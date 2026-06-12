import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PdfRenderError, renderApplicationPages } from './render';

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

  it('classifies the single-page synthetic fixture as form+label-front (U11)', async () => {
    // U11: with no marker pages and no separate label pages, the form page
    // also holds the label. We tag as 'form+label-front' (not the legacy
    // 'form+label') so the source-viewer can still surface a Front tab.
    const pdf = await readFile(SCENARIO_PDF);
    const pages = await renderApplicationPages(pdf);
    expect(pages[0]!.pageNumber).toBe(1);
    expect(pages[0]!.kind).toBe('form+label-front');
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

  // --- U11: front/back label tagging on real cola fixtures ---

  it('Layout B: Bouchard — caption + image share the same page', async () => {
    // Bouchard is a 4-page export. Page 2 carries the "Brand (front)" caption
    // PLUS the actual front-label artwork (Bouchard Aîné & Fils Bourgogne
    // Chardonnay). Page 3 carries the "Image Type: Back" caption PLUS the
    // back/neck artwork. Page 4 is just the TTB form footer (no label).
    //
    // The earlier classifier assumed Layout A (caption on N, image on N+1)
    // and incorrectly mapped page 3 = front, page 4 = back. That meant the
    // source viewer showed the form footer to users clicking the Back tab.
    // Layout B detection (caption page with image content → that page IS the
    // artwork) corrects the mapping.
    const pdf = await readFile(COLA_BOUCHARD);
    const pages = await renderApplicationPages(pdf);
    const tagged = pages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind }));
    expect(tagged).toContainEqual({ pageNumber: 1, kind: 'form' });
    expect(tagged).toContainEqual({ pageNumber: 2, kind: 'label-front' });
    expect(tagged).toContainEqual({ pageNumber: 3, kind: 'label-back' });
  });

  it('U11: tags Chacewater pages — form on 1, back-label on 3 via continuation heuristic', async () => {
    // Chacewater is the sparse-back-label case from the spike. Page 3 has
    // <30 words but carries the artwork as image XObjects. The classifier's
    // continuation-label heuristic (low text + image content + no marker)
    // tags it 'label-back' so the source viewer still surfaces the artwork
    // even when the front-marker resolution doesn't claim it.
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

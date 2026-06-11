import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PdfRenderError, renderApplicationPages } from './render';

const SCENARIO_PDF = path.resolve(
  __dirname,
  '../../../public/samples/applications/01-ridge-creek-bourbon/application.pdf',
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

  it('classifies the single-page fixture as form+label', async () => {
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
});

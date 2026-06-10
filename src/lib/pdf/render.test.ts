import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PdfRenderError, renderPageOne } from './render';

const SCENARIO_PDF = path.resolve(
  __dirname,
  '../../../public/samples/applications/01-ridge-creek-bourbon/application.pdf',
);

describe('renderPageOne', () => {
  it('renders a known scenario PDF to a PNG buffer with PNG magic bytes', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const png = await renderPageOne(pdf);
    expect(png).toBeInstanceOf(Buffer);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it('returns a reasonably-sized PNG for a 200 DPI letter page', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const png = await renderPageOne(pdf);
    expect(png.length).toBeGreaterThan(50 * 1024);
  });

  it('produces deterministic dimensions for the same input', async () => {
    const pdf = await readFile(SCENARIO_PDF);
    const [a, b] = await Promise.all([renderPageOne(pdf), renderPageOne(pdf)]);
    expect(a.length).toBe(b.length);
  });

  it('throws PdfRenderError on empty input', async () => {
    await expect(renderPageOne(Buffer.alloc(0))).rejects.toBeInstanceOf(PdfRenderError);
  });

  it('throws PdfRenderError on garbage input', async () => {
    await expect(renderPageOne(Buffer.from('not a pdf'))).rejects.toBeInstanceOf(
      PdfRenderError,
    );
  });
});

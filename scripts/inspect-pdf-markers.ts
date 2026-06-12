import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: tsx scripts/inspect-pdf-markers.ts <pdf-path>');
    process.exit(1);
  }
  const PDFJS_ROOT = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
  const STANDARD_FONT_DATA_URL = path.join(PDFJS_ROOT, 'standard_fonts') + '/';

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = await readFile(pdfPath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  console.log('pages:', doc.numPages);
  const OPS = pdfjs.OPS as Record<string, number>;
  const imageOpKeys = [
    'paintImageXObject',
    'paintInlineImageXObject',
    'paintImageMaskXObject',
    'paintImageXObjectRepeat',
    'paintImageMaskXObjectRepeat',
    'paintImageMaskXObjectGroup',
  ];
  const imageOpCodes = new Set(
    imageOpKeys.map((k) => OPS[k]).filter((c): c is number => typeof c === 'number'),
  );
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const text = await p.getTextContent();
    const items = (text.items as Array<{ str: string }>).map((t) => t.str).filter((s) => s.trim());
    const opList = await p.getOperatorList();
    const imageCount = opList.fnArray.filter((c) => imageOpCodes.has(c)).length;
    const joined = items.join(' ');
    const hits: string[] = [];
    for (const marker of [
      'Image Type:',
      'Image Type: Back',
      'Image Type: Brand',
      'Brand (front)',
      'or keg collar',
      'PART I - APPLICATION',
      'AFFIX',
      'BRAND NAME',
    ]) {
      if (joined.includes(marker)) hits.push(marker);
    }
    console.log(`\n--- PAGE ${i} --- ${items.length} text items, ${imageCount} image ops`);
    console.log('first 15 text:', items.slice(0, 15).map((s) => JSON.stringify(s)).join(' '));
    console.log('marker hits:', hits);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

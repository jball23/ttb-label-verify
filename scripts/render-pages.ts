import { writeFile, readFile } from 'node:fs/promises';
import { renderApplicationPages } from '../src/lib/pdf/render';

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: tsx scripts/render-pages.ts <pdf-path>');
    process.exit(1);
  }
  const buf = await readFile(pdfPath);
  const pages = await renderApplicationPages(buf);
  for (const p of pages) {
    const out = `/tmp/page-${p.pageNumber}-${p.kind}.png`;
    await writeFile(out, p.png);
    console.log(`wrote ${out} (${p.png.length} bytes)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

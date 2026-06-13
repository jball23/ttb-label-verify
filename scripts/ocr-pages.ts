import { readFile } from 'node:fs/promises';
import { renderApplicationPages } from '../src/lib/pdf/render';
import { runOcr, getWorker } from '../src/lib/ocr/worker';

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: tsx scripts/ocr-pages.ts <pdf-path>');
    process.exit(1);
  }
  const buf = await readFile(pdfPath);
  const pages = await renderApplicationPages(buf);
  for (const p of pages) {
    console.log(`\n=== PAGE ${p.pageNumber} (${p.kind}) ===`);
    const result = await runOcr(p.png);
    console.log(`mean conf: ${result.meanConfidence}, words: ${result.words.length}, latency: ${result.ocrLatencyMs}ms`);
    console.log('--- text ---');
    console.log(result.words.map((w) => w.text).join(' '));
    console.log('--- per-word ---');
    for (const w of result.words.slice(0, 80)) {
      console.log(`  ${w.confidence.toString().padStart(3)} ${JSON.stringify(w.text)}`);
    }
  }
  const w = await getWorker();
  await w.terminate();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

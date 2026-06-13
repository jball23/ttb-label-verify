#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * U2 — Tesseract.js spike against one real cola PDF.
 *
 * De-risks the core assumption from the plan: that Tesseract.js, run
 * server-side on a 200 DPI rendered TTB form/label page, reads the
 * verdict-driving fields (brand, ABV, government warning, net contents,
 * producer, country) with high enough confidence to be the primary
 * extractor — with VLM fallback only for the long tail.
 *
 * Outputs land in scripts/spike-output/:
 *   - <filename>-page-<N>-<kind>.png            — the rendered page (raw)
 *   - <filename>-page-<N>-<kind>-annotated.png  — same with word bboxes drawn
 *   - <filename>-page-<N>-<kind>-words.json     — full word list
 *   - <filename>-page-<N>-<kind>-lines.txt      — grouped-by-line view
 *   - findings.md                                — manual summary
 *
 * Run: `npx tsx scripts/tesseract-spike.ts [pdf-filename]`
 * Default PDF: 26083001000522-chacewater.pdf (multi-page export).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import Tesseract from 'tesseract.js';
import { renderApplicationPages } from '../src/lib/pdf/render';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'public', 'samples', 'cola');
const OUTPUT_DIR = path.join(REPO_ROOT, 'scripts', 'spike-output');

const DEFAULT_PDF = '26083001000522-chacewater.pdf';

interface WordRecord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface LineRecord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  wordCount: number;
}

interface PageOcrSummary {
  pageNumber: number;
  kind: string;
  imageWidth: number;
  imageHeight: number;
  ocrLatencyMs: number;
  wordCount: number;
  lineCount: number;
  meanWordConfidence: number;
  meanLineConfidence: number;
  lowConfidenceWordCount: number;
  highlightedFields: Record<string, { found: boolean; matchedText?: string; meanConfidence?: number }>;
}

const HIGHLIGHT_PATTERNS: Array<{ field: string; pattern: RegExp }> = [
  { field: 'governmentWarningPrefix', pattern: /GOVERNMENT\s+WARNING/i },
  { field: 'abvPercent', pattern: /\b\d{1,2}(\.\d{1,2})?\s*%/ },
  { field: 'proofValue', pattern: /\bproof\b/i },
  { field: 'netContentsMl', pattern: /\b\d+(\.\d+)?\s*m?L\b/i },
  { field: 'netContentsFlOz', pattern: /\bfl\.?\s*oz\b/i },
  { field: 'producedBy', pattern: /(?:produced|bottled|distilled|brewed|imported)\s+by/i },
  { field: 'productOf', pattern: /product\s+of/i },
  { field: 'alcVol', pattern: /alc(?:ohol)?\.?\s*(?:by\s+volume|\/?\s*vol)/i },
];

function drawAnnotation(
  pngBuffer: Buffer,
  words: WordRecord[],
): Promise<Buffer> {
  return loadImage(pngBuffer).then((image) => {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image as unknown as Parameters<typeof ctx.drawImage>[0], 0, 0);
    for (const w of words) {
      const lowConf = w.confidence < 60;
      ctx.strokeStyle = lowConf ? 'rgba(220, 38, 38, 0.85)' : 'rgba(16, 185, 129, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0);
    }
    return canvas.toBuffer('image/png');
  });
}

function summarizeWords(_words: WordRecord[], lines: LineRecord[]): PageOcrSummary['highlightedFields'] {
  const fullText = lines.map((l) => l.text).join(' ');
  const result: PageOcrSummary['highlightedFields'] = {};
  for (const { field, pattern } of HIGHLIGHT_PATTERNS) {
    const match = fullText.match(pattern);
    if (!match) {
      result[field] = { found: false };
      continue;
    }
    // Find the line that contains the match for a rough mean confidence.
    const matchedLine = lines.find((l) => pattern.test(l.text));
    result[field] = {
      found: true,
      matchedText: match[0],
      meanConfidence: matchedLine?.confidence,
    };
  }
  return result;
}

async function runPage(
  worker: Tesseract.Worker,
  baseName: string,
  page: { pageNumber: number; kind: string; png: Buffer },
): Promise<PageOcrSummary> {
  const ocrStart = Date.now();
  // Worker API with output: { blocks: true } is the v6 path to get the bbox
  // hierarchy. The top-level Tesseract.recognize convenience function doesn't
  // expose this.
  const result = await worker.recognize(
    page.png,
    {},
    { blocks: true, text: true },
  );
  const ocrLatencyMs = Date.now() - ocrStart;

  // Tesseract returns blocks > paragraphs > lines > words. Flatten.
  const blocks = result.data.blocks ?? [];
  const flatLines: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    words: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }> = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        flatLines.push(line);
      }
    }
  }
  const words: WordRecord[] = flatLines.flatMap((l) =>
    l.words.map((w) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox,
    })),
  );
  const lines: LineRecord[] = flatLines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    bbox: l.bbox,
    wordCount: l.words.length,
  }));

  const meanWordConfidence =
    words.length === 0 ? 0 : Math.round(words.reduce((a, w) => a + w.confidence, 0) / words.length);
  const meanLineConfidence =
    lines.length === 0 ? 0 : Math.round(lines.reduce((a, l) => a + l.confidence, 0) / lines.length);
  const lowConfidenceWordCount = words.filter((w) => w.confidence < 60).length;

  // Write artifacts.
  const tag = `${baseName}-page-${page.pageNumber}-${page.kind}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, `${tag}.png`), page.png);
  const annotated = await drawAnnotation(page.png, words);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${tag}-annotated.png`), annotated);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${tag}-words.json`),
    JSON.stringify(words, null, 2),
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${tag}-lines.txt`),
    lines
      .map(
        (l) =>
          `[conf=${Math.round(l.confidence).toString().padStart(3, ' ')}] ${l.text}`,
      )
      .join('\n'),
  );

  // Get image dimensions from the loaded image (or fall back to a small load).
  const image = await loadImage(page.png);
  return {
    pageNumber: page.pageNumber,
    kind: page.kind,
    imageWidth: image.width,
    imageHeight: image.height,
    ocrLatencyMs,
    wordCount: words.length,
    lineCount: lines.length,
    meanWordConfidence,
    meanLineConfidence,
    lowConfidenceWordCount,
    highlightedFields: summarizeWords(words, lines),
  };
}

async function main(): Promise<void> {
  const pdfFilename = process.argv[2] ?? DEFAULT_PDF;
  const pdfPath = path.join(SAMPLES_DIR, pdfFilename);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found at ${pdfPath}`);
    process.exit(1);
  }
  const baseName = path.basename(pdfFilename, '.pdf');
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Spike target: ${pdfFilename}`);
  console.log('Rendering PDF pages...');
  const renderStart = Date.now();
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pages = await renderApplicationPages(pdfBuffer);
  console.log(
    `Rendered ${pages.length} page(s) in ${Date.now() - renderStart}ms: [${pages
      .map((p) => `${p.pageNumber}:${p.kind}`)
      .join(', ')}]`,
  );

  console.log('Initializing Tesseract worker (loads eng.traineddata)...');
  const workerStart = Date.now();
  const worker = await Tesseract.createWorker('eng');
  console.log(`Worker ready in ${Date.now() - workerStart}ms`);

  console.log('Running Tesseract OCR per page...');
  const summaries: PageOcrSummary[] = [];
  try {
    for (const page of pages) {
      summaries.push(await runPage(worker, baseName, page));
    }
  } finally {
    await worker.terminate();
  }

  // Write findings markdown.
  const findingsLines: string[] = [];
  findingsLines.push(`# Tesseract.js spike — ${pdfFilename}`);
  findingsLines.push('');
  findingsLines.push(`Captured: ${new Date().toISOString()}`);
  findingsLines.push('');
  findingsLines.push('## Per-page summary');
  findingsLines.push('');
  findingsLines.push(
    '| Page | Kind | Dims (px) | OCR (ms) | Words | Lines | Mean word conf | Mean line conf | Low-conf words |',
  );
  findingsLines.push(
    '|------|------|-----------|----------|-------|-------|----------------|----------------|-----------------|',
  );
  for (const s of summaries) {
    findingsLines.push(
      `| ${s.pageNumber} | ${s.kind} | ${s.imageWidth}×${s.imageHeight} | ${s.ocrLatencyMs} | ${s.wordCount} | ${s.lineCount} | ${s.meanWordConfidence} | ${s.meanLineConfidence} | ${s.lowConfidenceWordCount} |`,
    );
  }
  findingsLines.push('');
  findingsLines.push('## Highlight-pattern coverage');
  findingsLines.push('');
  findingsLines.push(
    'Which verdict-driving signals did Tesseract recognize on each page? `found=true` means the regex matched; mean-conf is the matching line\'s confidence.',
  );
  findingsLines.push('');
  for (const s of summaries) {
    findingsLines.push(`### Page ${s.pageNumber} (${s.kind})`);
    findingsLines.push('');
    findingsLines.push('| Pattern | Found | Matched | Line conf |');
    findingsLines.push('|---------|-------|---------|-----------|');
    for (const [field, result] of Object.entries(s.highlightedFields)) {
      findingsLines.push(
        `| ${field} | ${result.found ? '✓' : '✗'} | ${result.matchedText ?? '—'} | ${result.meanConfidence ?? '—'} |`,
      );
    }
    findingsLines.push('');
  }
  findingsLines.push('## Total OCR latency');
  findingsLines.push('');
  const totalOcrMs = summaries.reduce((a, s) => a + s.ocrLatencyMs, 0);
  findingsLines.push(`${totalOcrMs}ms across ${summaries.length} page(s).`);
  findingsLines.push('');
  findingsLines.push('## Manual notes (fill in after inspecting annotated PNGs)');
  findingsLines.push('');
  findingsLines.push('- Brand-name word: ');
  findingsLines.push('- ABV format: ');
  findingsLines.push('- Government Warning (multi-line span?): ');
  findingsLines.push('- Net contents (unit recognized?): ');
  findingsLines.push('- Producer / country of origin: ');
  findingsLines.push('- Decorative wordmark fields likely needing VLM fallback: ');

  fs.writeFileSync(path.join(OUTPUT_DIR, 'findings.md'), findingsLines.join('\n'));
  console.log('\n=== Spike summary ===');
  for (const s of summaries) {
    console.log(
      `Page ${s.pageNumber} (${s.kind}): ${s.wordCount} words, mean conf ${s.meanWordConfidence}, ocr ${s.ocrLatencyMs}ms`,
    );
  }
  console.log(`\nWrote: ${path.join(OUTPUT_DIR, 'findings.md')}`);
  console.log(`Annotated PNGs in: ${OUTPUT_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

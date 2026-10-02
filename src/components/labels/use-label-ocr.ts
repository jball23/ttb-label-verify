'use client';

import { useEffect, useState } from 'react';
import type { Block, Worker } from 'tesseract.js';
import { type Box, type OcrWord } from '@/lib/labels/locate-text';

export type OcrState =
  | { status: 'loading' }
  | { status: 'ready'; words: OcrWord[] }
  | { status: 'failed' };

/** Tesseract reads small type far better when it is larger; boxes are scaled back after. */
const OCR_TARGET_WIDTH = 2400;
const MAX_UPSCALE = 2.5;

async function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();
  return image;
}

/** The scales to read at: as uploaded, plus enlarged when the image is small. */
async function passScales(imageUrl: string): Promise<number[]> {
  const { naturalWidth } = await loadImage(imageUrl);
  const enlarged = Math.min(MAX_UPSCALE, Math.max(1, OCR_TARGET_WIDTH / naturalWidth));
  return enlarged > 1.2 ? [1, enlarged] : [1];
}

async function render(imageUrl: string, scale: number): Promise<HTMLCanvasElement> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Adds one pass's words in image pixels, each printed line with its own line number. */
function appendWords(words: OcrWord[], blocks: Block[], scale: number): void {
  let line = words.length === 0 ? 0 : words[words.length - 1]!.line + 1;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const printed of paragraph.lines) {
        for (const word of printed.words)
          words.push({ text: word.text, bbox: shrink(word.bbox, scale), line });
        line += 1;
      }
    }
  }
}

function shrink(box: Box, scale: number): Box {
  return {
    x0: box.x0 / scale,
    y0: box.y0 / scale,
    x1: box.x1 / scale,
    y1: box.y1 / scale,
  };
}

/** One worker per tab, created on first use and reused for every label reviewed after. */
let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= import('tesseract.js').then(async ({ createWorker, PSM }) => {
    // Served from this site (scripts/copy-ocr-assets.mjs), never a CDN.
    const worker = await createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      gzip: true,
    });
    // Labels are scattered text over artwork, not a page of prose. Sparse-text
    // mode finds small lines (e.g. "80 PROOF") the default layout analysis skips.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return worker;
  });
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

/**
 * Word boxes for a label image, found in the browser after the review page
 * has rendered. Lazy by design: nothing loads until a label is reviewed, and
 * the check itself never waits for it.
 */
export function useLabelOcr(imageUrl: string): OcrState {
  const [state, setState] = useState<OcrState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const run = async () => {
      try {
        const worker = await getWorker();
        // Two passes: as uploaded (large display type) and enlarged (small
        // type such as the warning). Each finds text the other misses.
        const words: OcrWord[] = [];
        for (const scale of await passScales(imageUrl)) {
          const canvas = await render(imageUrl, scale);
          const { data } = await worker.recognize(canvas, {}, { blocks: true });
          if (cancelled) return;
          appendWords(words, data.blocks ?? [], scale);
        }
        setState({ status: 'ready', words });
      } catch {
        if (!cancelled) setState({ status: 'failed' });
      }
    };
    // Let the page finish painting before loading the engine.
    const handle = window.setTimeout(run, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [imageUrl]);

  return state;
}

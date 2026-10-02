'use client';

import { useEffect, useState } from 'react';
import type { Worker } from 'tesseract.js';
import { type Box, type OcrWord } from '@/lib/labels/locate-text';

export type OcrState =
  | { status: 'loading' }
  | { status: 'ready'; words: OcrWord[] }
  | { status: 'failed' };

/** Tesseract reads small type far better when it is larger; boxes are scaled back after. */
const OCR_TARGET_WIDTH = 2400;
const MAX_UPSCALE = 2.5;

async function enlarge(imageUrl: string): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();
  const scale = Math.min(MAX_UPSCALE, Math.max(1, OCR_TARGET_WIDTH / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

function shrink(box: Box, scale: number): Box {
  return { x0: box.x0 / scale, y0: box.y0 / scale, x1: box.x1 / scale, y1: box.y1 / scale };
}

/** One worker per tab, created on first use and reused for every label reviewed after. */
let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= import('tesseract.js').then(({ createWorker }) =>
    // Served from this site (scripts/copy-ocr-assets.mjs), never a CDN.
    createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', gzip: true }),
  );
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
        const [worker, { canvas, scale }] = await Promise.all([getWorker(), enlarge(imageUrl)]);
        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        if (cancelled) return;
        let line = 0;
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? []) {
          for (const paragraph of block.paragraphs) {
            for (const printed of paragraph.lines) {
              for (const word of printed.words) words.push({ text: word.text, bbox: shrink(word.bbox, scale), line });
              line += 1;
            }
          }
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

'use client';

import { useCallback, useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { CORRECTABLE_FIELDS, type CorrectableField } from '@/lib/labels/corrections';
import { locateText, type Box } from '@/lib/labels/locate-text';
import { cn } from '@/lib/utils';
import { useLabelOcr } from './use-label-ocr';

interface Props {
  imageUrl: string;
  alt: string;
  /** For each item, the text to outline on the photo; null when it is not on the label. */
  targets: Record<CorrectableField, string | null>;
  /** The field or check the reviewer is pointing at, if any. */
  highlight: CorrectableField | null;
  /** Taller when the review list is collapsed and the photo has more room. */
  large?: boolean;
  onZoom(): void;
}

/**
 * The label photo. When the reviewer hovers a field or check, the text it
 * refers to is outlined; nothing is drawn otherwise.
 */
export function LabelPhoto({
  imageUrl,
  alt,
  targets,
  highlight,
  large = false,
  onZoom,
}: Props) {
  const ocr = useLabelOcr(imageUrl);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // A cached image can finish loading before React attaches onLoad, so also
  // read the size as soon as the element exists.
  const measure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth)
      setSize({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const locations = useMemo(() => {
    if (ocr.status !== 'ready') return null;
    return Object.fromEntries(
      CORRECTABLE_FIELDS.map((field) => [field, locateText(ocr.words, targets[field])]),
    ) as Record<CorrectableField, Box[] | null>;
  }, [ocr, targets]);

  const boxes = highlight && locations ? locations[highlight] : null;
  const notice = highlight ? noticeFor(targets[highlight], ocr.status, boxes) : null;

  return (
    <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
      <img
        ref={measure}
        src={imageUrl}
        alt={alt}
        onLoad={(event) =>
          setSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        className={cn(
          'block h-auto w-auto max-w-full',
          large ? 'max-h-[80svh]' : 'max-h-[70svh]',
        )}
      />
      {boxes && size
        ? boxes.map((box, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-2 border-sky-500 bg-sky-400/20"
              style={toPercentBox(box, size)}
            />
          ))
        : null}
      {notice ? (
        <span
          role="status"
          className="absolute left-3 top-3 rounded-full bg-background/95 px-3 py-1.5 text-sm font-medium shadow-sm"
        >
          {notice}
        </span>
      ) : null}
      {/* Tucked into the corner: the container's rounding and overflow clip the
          outer corner, so it covers as little of the label as possible. */}
      <button
        type="button"
        onClick={onZoom}
        aria-label="Look closer"
        title="Look closer"
        className="absolute bottom-0 right-0 inline-flex size-10 items-center justify-center rounded-tl-xl border-l border-t border-border bg-background/90 text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ZoomIn aria-hidden className="size-5" />
      </button>
    </div>
  );
}

/** Positions a box given in image pixels, with a little breathing room around the text. */
function toPercentBox(
  box: Box,
  size: { width: number; height: number },
): React.CSSProperties {
  const pad = Math.max(3, size.width * 0.004);
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(size.width, box.x1 + pad);
  const y1 = Math.min(size.height, box.y1 + pad);
  return {
    left: `${(x0 / size.width) * 100}%`,
    top: `${(y0 / size.height) * 100}%`,
    width: `${((x1 - x0) / size.width) * 100}%`,
    height: `${((y1 - y0) / size.height) * 100}%`,
  };
}

function noticeFor(
  target: string | null,
  status: 'loading' | 'ready' | 'failed',
  boxes: Box[] | null,
): string | null {
  if (!target) return 'Not on the label';
  if (status === 'loading') return 'Finding text on the photo…';
  if (status === 'failed') return 'Highlighting is unavailable';
  return boxes ? null : "Couldn't find this on the photo";
}

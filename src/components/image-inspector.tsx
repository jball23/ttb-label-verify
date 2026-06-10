'use client';

import { useState, useRef, useEffect, type MouseEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  imageUrl: string | null;
  alt: string;
}

const LENS_SIZE = 200;
const DEFAULT_ZOOM = 2.5;
const MAX_ZOOM = 6;
const MIN_ZOOM = 1.5;

/**
 * Full-image inspector with a magnifier lens that follows the cursor.
 *
 * Hover anywhere on the image to see a circular zoomed region. Wheel-scroll
 * over the image to adjust zoom level (1.5x–6x). "Reset" returns to default.
 */
export function ImageInspector({ open, onOpenChange, imageUrl, alt }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!open) setHover(false);
  }, [open]);

  function handleMove(e: MouseEvent<HTMLDivElement>): void {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPos({ x: Math.max(0, Math.min(rect.width, x)), y: Math.max(0, Math.min(rect.height, y)) });
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>): void {
    e.preventDefault();
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + (e.deltaY > 0 ? -0.25 : 0.25))));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="flex max-h-[90svh] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="truncate text-sm font-semibold">{alt}</h2>
            <p className="text-[11px] text-muted-foreground">
              Hover to magnify · scroll to adjust zoom
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {zoom.toFixed(1)}×
            </span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => setZoom(DEFAULT_ZOOM)}
              aria-label="Reset zoom"
            >
              <RotateCw className="size-3.5" />
            </Button>
          </div>
        </div>
        <div
          className="relative flex-1 overflow-hidden bg-muted/40"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onMouseMove={handleMove}
          onWheel={handleWheel}
        >
          {imageUrl && (
            <div className="flex h-full max-h-[78svh] items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt={alt}
                onLoad={handleImageLoad}
                className="max-h-full max-w-full select-none rounded-md object-contain shadow-sm"
                draggable={false}
              />
              {hover && imgRef.current && naturalSize.w > 0 && (
                <Lens
                  pos={pos}
                  zoom={zoom}
                  imageUrl={imageUrl}
                  displayed={{
                    width: imgRef.current.clientWidth,
                    height: imgRef.current.clientHeight,
                    left: imgRef.current.offsetLeft,
                    top: imgRef.current.offsetTop,
                  }}
                  natural={naturalSize}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

interface LensProps {
  pos: { x: number; y: number };
  zoom: number;
  imageUrl: string;
  displayed: { width: number; height: number; left: number; top: number };
  natural: { w: number; h: number };
}

function Lens({ pos, zoom, imageUrl, displayed, natural }: LensProps) {
  // Background size = displayed dims * zoom. Position offsets so the cursor's
  // image-coord is centered in the lens.
  const bgWidth = displayed.width * zoom;
  const bgHeight = displayed.height * zoom;
  const bgX = -(pos.x * zoom - LENS_SIZE / 2);
  const bgY = -(pos.y * zoom - LENS_SIZE / 2);

  return (
    <div
      className="pointer-events-none absolute rounded-full border-2 border-foreground/80 shadow-2xl ring-2 ring-background"
      style={{
        width: LENS_SIZE,
        height: LENS_SIZE,
        left: displayed.left + pos.x - LENS_SIZE / 2,
        top: displayed.top + pos.y - LENS_SIZE / 2,
        backgroundImage: `url(${imageUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        // Subtle crosshair
        boxShadow: '0 0 0 1px rgba(0,0,0,0.05), 0 20px 40px -10px rgba(0,0,0,0.4)',
      }}
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/40 ring-2 ring-background/80" />
      <span className="sr-only">Natural size: {natural.w}×{natural.h}</span>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, type MouseEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { MousePointer2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  imageUrl: string | null;
  alt: string;
}

const DEFAULT_ZOOM = 2.5;
const MAX_ZOOM = 8;
const MIN_ZOOM = 1;

/**
 * Full-image inspector with zoom-into-cursor on hover.
 *
 * Default view: image fit to the modal. On hover, the image scales up to the
 * current zoom level with transform-origin tracking the cursor — so the area
 * under the mouse becomes the focal point of the magnification. Mouse-wheel
 * adjusts zoom (1×–8×). "Reset" returns to default.
 */
export function ImageInspector({ open, onOpenChange, imageUrl, alt }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Reset hover state and zoom when the modal closes
  useEffect(() => {
    if (!open) {
      setHovering(false);
      setOrigin({ x: 50, y: 50 });
      setZoom(DEFAULT_ZOOM);
    }
  }, [open]);

  // Attach the wheel listener with { passive: false } so preventDefault works.
  // React's onWheel registers as a passive listener — preventDefault is a no-op
  // there, which lets the browser scroll the page underneath the modal.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + (e.deltaY > 0 ? -0.25 : 0.25))));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  function handleMove(e: MouseEvent<HTMLDivElement>): void {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="max-w-6xl w-[min(95vw,80rem)]"
    >
      <div className="flex max-h-[92svh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 pr-14">
          <h2 className="truncate text-sm font-semibold">{alt}</h2>
          <p className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <MousePointer2 className="size-3" />
            Hover to zoom · scroll to adjust
          </p>
        </div>

        {/* Image viewport */}
        <div
          ref={containerRef}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onMouseMove={handleMove}
          className={cn(
            'relative flex flex-1 items-center justify-center overflow-hidden bg-muted/40',
            hovering ? 'cursor-zoom-in' : 'cursor-pointer',
          )}
          style={{ minHeight: '60vh' }}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={alt}
              draggable={false}
              className="max-h-[78svh] max-w-full select-none object-contain shadow-sm transition-transform duration-100 ease-out will-change-transform"
              style={{
                transform: hovering ? `scale(${zoom})` : 'scale(1)',
                transformOrigin: `${origin.x}% ${origin.y}%`,
              }}
            />
          )}
          {!hovering && imageUrl && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
              Hover over the image to zoom
            </div>
          )}
          {hovering && imageUrl && (
            <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur-sm">
              {zoom.toFixed(1)}×
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

'use client';

import { Sparkles } from 'lucide-react';

/**
 * Affordance for VLM-fallback fields. The PDF/OCR pipeline didn't
 * extract this field, so the OpenAI single-field fallback produced the
 * value — there's no on-page bbox to highlight. The full original PDF stays
 * visible and this notice explains why no exact box appeared.
 */
export default function NoSourceOverlay({ fieldLabel }: { fieldLabel?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-4">
      <div className="pointer-events-auto max-w-sm rounded-md border border-sky-400/40 bg-sky-50/95 px-3 py-2 text-[11px] text-sky-900 shadow-sm backdrop-blur dark:bg-sky-950/90 dark:text-sky-100">
        <div className="mb-1 flex items-center gap-1.5 font-medium">
          <Sparkles className="size-3.5" />
          AI-extracted, exact source not available
        </div>
        <p className="text-[10.5px] leading-snug text-sky-900/80 dark:text-sky-100/80">
          {fieldLabel ? `“${fieldLabel}” was ` : 'This value was '}filled by the
          OpenAI vision fallback because the page OCR didn&apos;t find a
          confident match. No exact source box is available for this value.
        </p>
      </div>
    </div>
  );
}

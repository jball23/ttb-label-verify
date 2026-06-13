/**
 * Detail-view field-routing logic. Given a FieldPath and the report's
 * FieldBboxes sidecar, return:
 *   - which source-viewer tab (`form` | `front` | `back`) the field maps to,
 *   - the page number to display, when known,
 *   - the word rects to highlight, or `null` when the field came from VLM
 *     fallback / wasn't matched (caller renders NoSourceOverlay instead).
 *
 * Pure module — no React, no DOM, no Tesseract. Designed so the tab-switch
 * + bbox highlight wiring stays trivially testable. Plan unit: U8.
 */
import { type FieldBbox, type FieldBboxes, type FieldPath, type WordRect } from '../extraction/types';

export type SourceTab = 'form' | 'front' | 'back';

export interface FieldSelection {
  tab: SourceTab;
  /** 1-indexed PDF page. May be null when the field never produced a bbox. */
  page: number | null;
  /** Word rects to highlight; null for VLM fallback / unknown source. */
  words: WordRect[] | null;
  /** True when the field came from VLM fallback — caller renders NoSourceOverlay. */
  isVlmFallback: boolean;
}

/**
 * Tab inference from the field path. Used ONLY by `derivePageKinds` to
 * classify pages from their landed bboxes when the renderer-emitted page
 * metadata isn't available (legacy archived rows). The heuristic is "a page
 * with a GW bbox is probably a back-label page" — fine for page tagging,
 * but NOT what `selectField` uses for field routing.
 *
 * Field routing uses `pickTab` below, which is side-agnostic for every
 * label.* field except `brandName` (the brand wordmark IS universally front).
 */
function tabFromPath(fieldPath: FieldPath): SourceTab {
  if (fieldPath.startsWith('application.')) return 'form';
  if (fieldPath === 'label.governmentWarning') return 'back';
  return 'front';
}

/**
 * For label.* fields without a hardcoded side bias, return the first label
 * tab that actually has a page in this document. Side-agnostic — keeps a
 * back-only label (rare on wine, common on kegs/cans Phase C) from rendering
 * with an empty Front tab.
 */
function firstAvailableLabelTab(
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): SourceTab {
  const kinds = derivePageKinds(bboxes, pages);
  for (const kind of kinds.values()) {
    if (kind === 'front') return 'front';
  }
  for (const kind of kinds.values()) {
    if (kind === 'back') return 'back';
  }
  return 'front';
}

/** Page-render metadata passed through from the renderer via the report. */
export interface PageMeta {
  pageNumber: number;
  /** Classifier-emitted kind: `form`, `form+label-front`, `label-front`,
   * `label-back`, `label`, `unknown`, etc. */
  kind: string;
}

function kindToTab(kind: string): SourceTab | null {
  // Order matters: the classifier emits compound kinds like `form+label-front`
  // (the form page on a single-page application that also has a front label).
  // We prefer the more-specific tag (form wins) in that case.
  if (kind.includes('form')) return 'form';
  if (kind.includes('back')) return 'back';
  if (kind.includes('front')) return 'front';
  if (kind.includes('label')) return 'front';
  return null;
}

/**
 * Derive the kind of each page from BOTH:
 *   1. The render-classifier output (`pages`), which knows every PDF page
 *      and its kind even when no bbox happened to land on it. Authoritative
 *      when available.
 *   2. The FieldBboxes sidecar, as a fallback for archived rows that
 *      predate the `pages` wire field (and as a tiebreaker on weird
 *      multi-kind pages).
 *
 * On conflict we prefer the more specific kind in this order:
 *   form > back > front,
 * so a page that holds form fields is always shown under Form even if a
 * stray label bbox landed there.
 */
export function derivePageKinds(
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): Map<number, SourceTab> {
  const result = new Map<number, SourceTab>();
  const lockedBySpecificPageMeta = new Set<number>();
  const rank: Record<SourceTab, number> = { form: 3, back: 2, front: 1 };

  // 1. Render-classifier data first — these page numbers come straight
  //    from the PDF render pipeline.
  if (pages) {
    for (const p of pages) {
      const tab = kindToTab(p.kind);
      if (!tab) continue;
      const existing = result.get(p.pageNumber);
      if (!existing || rank[tab] > rank[existing]) {
        result.set(p.pageNumber, tab);
      }
      if (
        p.kind.includes('form') ||
        p.kind.includes('front') ||
        p.kind.includes('back')
      ) {
        lockedBySpecificPageMeta.add(p.pageNumber);
      }
    }
  }

  // 2. Bbox-derived (fallback / tiebreaker).
  if (bboxes) {
    for (const [path, bbox] of Object.entries(bboxes) as Array<[FieldPath, FieldBbox | undefined]>) {
      if (!bbox || bbox.source === 'vlm' || bbox.words.length === 0) continue;
      if (lockedBySpecificPageMeta.has(bbox.page)) continue;
      const candidate = tabFromPath(path);
      const existing = result.get(bbox.page);
      if (!existing || rank[candidate] > rank[existing]) {
        result.set(bbox.page, candidate);
      }
    }
  }

  return result;
}

/**
 * Which tabs are populated by at least one page. Drives the enabled/disabled
 * state of the tab strip — `Back` greys out on documents with no back-label
 * page, `Front` on documents with no artwork, etc.
 */
export function availableTabs(
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): Set<SourceTab> {
  const tabs = new Set<SourceTab>();
  for (const tab of derivePageKinds(bboxes, pages).values()) tabs.add(tab);
  return tabs;
}

/**
 * Pick a representative PDF page for a tab. Returns the lowest-numbered
 * page tagged with that tab's kind, or null if no page qualifies. Used
 * when the user clicks a tab directly (no specific field selected).
 */
export function pageForTab(
  tab: SourceTab,
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): number | null {
  const kinds = derivePageKinds(bboxes, pages);
  let best: number | null = null;
  for (const [page, kind] of kinds) {
    if (kind !== tab) continue;
    if (best === null || page < best) best = page;
  }
  return best;
}

/**
 * Main routing function: given a clicked field, decide which tab, page,
 * and words drive the right-pane viewer.
 */
export function selectField(
  fieldPath: FieldPath,
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): FieldSelection {
  const bbox = bboxes?.[fieldPath];

  // PDF/OCR bbox with actual words — highlight them on their page.
  if (bbox && bbox.source !== 'vlm' && bbox.words.length > 0) {
    const kinds = derivePageKinds(bboxes, pages);
    const tab = kinds.get(bbox.page) ?? tabFromPath(fieldPath);
    return {
      tab,
      page: bbox.page,
      words: bbox.words,
      isVlmFallback: false,
    };
  }

  // VLM fallback — surface the tab the field WOULD belong to, but with no
  // bbox highlight. Caller renders NoSourceOverlay.
  if (bbox && bbox.source === 'vlm') {
    const tab = pickTab(fieldPath, bboxes, pages);
    return {
      tab,
      page: pageForTab(tab, bboxes, pages),
      words: null,
      isVlmFallback: true,
    };
  }

  // No bbox at all — same affordance as VLM fallback (likely because the
  // legacy provenance-only path is in play, or the extractor produced no
  // entry).
  const tab = pickTab(fieldPath, bboxes, pages);
  return {
    tab,
    page: pageForTab(tab, bboxes, pages),
    words: null,
    isVlmFallback: false,
  };
}

/**
 * Compose `tabFromPath` (hardcoded bias) with `firstAvailableLabelTab`
 * (per-document fallback) for the no-bbox path. Side-agnostic for every
 * label.* field except brandName: brandName keeps its `front` bias because
 * the brand wordmark is universally on the front.
 */
function pickTab(
  fieldPath: FieldPath,
  bboxes: FieldBboxes | undefined,
  pages?: ReadonlyArray<PageMeta>,
): SourceTab {
  if (fieldPath.startsWith('application.')) return 'form';
  if (fieldPath === 'label.brandName') return 'front';
  return firstAvailableLabelTab(bboxes, pages);
}

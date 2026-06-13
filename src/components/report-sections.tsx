'use client';

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  Info,
  ChevronUp,
} from 'lucide-react';
import { type ResultLine } from '@/lib/results/result-types';
import { type FieldStatus } from '@/lib/validation/types';
import {
  type CrossCheckFieldId,
  type CrossCheckFieldResult,
  CROSS_CHECK_FIELD_LABELS,
} from '@/lib/cross-check/types';
import { type CfrCitation } from '@/lib/validation/types';
import { RULES } from '@/lib/validation/engine';
import {
  type FieldBboxes,
  type FieldPath,
  type ProvenanceMap,
} from '@/lib/extraction/types';
import { cn } from '@/lib/utils';

type OkResultLine = Extract<ResultLine, { status: 'ok' }>;
type WireReport = OkResultLine['report'];

// Two paths per app-vs-label comparison — one for the application side
// (Item N on the form) and one for the label side. These now render inline
// under the relevant TTB rule row instead of in a separate section.
const COMPARISON_PATHS: Record<
  CrossCheckFieldId,
  { app: FieldPath | null; label: FieldPath | null }
> = {
  brandName: { app: 'application.brandName', label: 'label.brandName' },
  classType: { app: 'application.fancifulName', label: 'label.classType' },
  producer: { app: 'application.applicant.name', label: 'label.producer' },
  countryOfOrigin: { app: 'application.source', label: 'label.countryOfOrigin' },
  wineVarietal: { app: 'application.grapeVarietals', label: 'label.wineVarietal' },
  wineAppellation: {
    app: 'application.wineAppellation',
    label: 'label.wineAppellation',
  },
};

const RULE_TO_COMPARISON_IDS: Partial<Record<string, CrossCheckFieldId[]>> = {
  brand: ['brandName'],
  classType: ['classType'],
  producerOrigin: ['producer', 'countryOfOrigin'],
};

const WINE_COMPARISON_IDS: ReadonlyArray<CrossCheckFieldId> = [
  'wineVarietal',
  'wineAppellation',
];

const WINE_CFR: CfrCitation = {
  section: '27 CFR §4.23 / §4.25',
  summary:
    'Wine labels that state a grape varietal or appellation must be entitled to those designations and should match the submitted COLA application.',
  quote:
    'Varietal and appellation names may be used only for wines meeting the applicable wine-labeling requirements.',
};

const RULE_TO_LABEL_PATH: Record<string, FieldPath | null> = {
  brand: 'label.brandName',
  abv: 'label.abv',
  governmentWarning: 'label.governmentWarning',
  netContents: 'label.netContents',
  classType: 'label.classType',
  producerOrigin: 'label.producer',
};

// Display order for the rules section — reading order on the actual label
// (top-to-bottom: brand mark, fanciful name, ABV, net contents, producer +
// country, then the small-print government warning at the bottom). This
// is separate from the engine's `RULES` array which controls verdict
// computation order (governmentWarning before netContents etc. so the
// non_compliant verdict is decided early).
const RULE_DISPLAY_ORDER: ReadonlyArray<string> = [
  'brand',
  'classType', // surfaces fanciful name + class/type designation
  'abv',
  'netContents',
  'producerOrigin',
  'governmentWarning',
];

// ---------------------------------------------------------------------------

function statusToDotColor(status: FieldStatus | null): string {
  switch (status) {
    case 'pass':
      return 'bg-emerald-500';
    case 'fail':
      return 'bg-rose-500';
    case 'warn':
    case 'uncertain':
      return 'bg-amber-500';
    default:
      return 'bg-muted';
  }
}

// Reason copy under each comparison note should read in the same color
// family as its icon — sky for "informational, label has extra info" and
// amber for "values differ, reviewer should glance." Both stay
// intentionally non-rose since cross-check never rejects a label.
function crossCheckStatusToReasonText(status: CrossCheckFieldResult['status']): string {
  switch (status) {
    case 'mismatch':
    case 'not_on_label':
      return 'text-amber-600 dark:text-amber-400';
    case 'not_on_application':
      return 'text-sky-600 dark:text-sky-400';
    default:
      return 'text-muted-foreground';
  }
}

function comparisonReason(
  field: CrossCheckFieldResult,
  labelIsAlreadyShown: boolean,
): string | null {
  if (!field.reason || field.status === 'match') return null;
  if (!labelIsAlreadyShown) return field.reason;
  if (field.status === 'mismatch') {
    return 'Application value may differ from the label value above.';
  }
  if (field.status === 'not_on_label') {
    return 'Application declares this value, but it may not have been detected on the label.';
  }
  return field.reason;
}

// ---------------------------------------------------------------------------

/**
 * A field is "navigable" (clickable to highlight in the PDF) when EITHER
 * source has an entry for its path:
 *  - the legacy full-document OpenAI provenance map, OR
 *  - the current FieldBbox sidecar (PDF/OCR word rects or VLM no-source marker).
 *
 * Under the Tesseract pipeline `provenance` is always `{}`, so this OR is
 * what keeps the rows live during the swap.
 */
function isFieldNavigable(
  path: FieldPath | null,
  provenance: ProvenanceMap,
  bboxes: FieldBboxes | undefined,
): boolean {
  if (!path) return false;
  if (provenance[path]) return true;
  if (bboxes && bboxes[path]) return true;
  return false;
}

/**
 * Surface the "low confidence" badge from whichever source has it. Legacy
 * provenance uses a coarse 'low' enum; Tesseract carries a numeric
 * meanConfidence and we treat <70 as low (matches the OCR threshold in
 * src/lib/ocr/config.ts plus a small visual buffer).
 */
function isFieldLowConfidence(
  path: FieldPath | null,
  provenance: ProvenanceMap,
  bboxes: FieldBboxes | undefined,
): boolean {
  if (!path) return false;
  if (provenance[path]?.confidence === 'low') return true;
  const bb = bboxes?.[path];
  if (bb && bb.meanConfidence !== null && bb.meanConfidence < 70) return true;
  return false;
}

/**
 * Source-of-truth indicator for a single field: was the value pulled by
 * Tesseract OCR (with a real bbox on the page), filled by the VLM fallback
 * (text-only, no bbox coordinates), or missing entirely. Drives the
 * per-row "OCR" vs "AI" badge so the reviewer knows what to trust before
 * clicking.
 */
type FieldSource = 'pdf' | 'tesseract' | 'vlm' | 'none';

function fieldSource(
  path: FieldPath | null,
  provenance: ProvenanceMap,
  bboxes: FieldBboxes | undefined,
): FieldSource {
  if (!path) return 'none';
  const bb = bboxes?.[path];
  if (bb?.source === 'pdf' && bb.words.length > 0) return 'pdf';
  if (bb?.source === 'tesseract' && bb.words.length > 0) return 'tesseract';
  if (bb?.source === 'vlm') return 'vlm';
  if (provenance[path]) return 'tesseract'; // legacy full-document bbox path
  return 'none';
}

function SourceBadge({ source, confidence }: { source: FieldSource; confidence?: number | null }) {
  if (source === 'none') return null;
  if (source === 'pdf') {
    return (
      <span
        title="Read from the PDF text layer. Click the field to highlight it on the form."
        className="inline-flex items-center gap-1 rounded-sm border border-cyan-700/40 bg-cyan-950/30 px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide text-cyan-400"
      >
        PDF
      </span>
    );
  }
  if (source === 'tesseract') {
    return (
      <span
        title={
          confidence != null
            ? `Read by OCR with ${confidence}% confidence. Click the field to highlight on the label.`
            : 'Read by OCR. Click the field to highlight on the label.'
        }
        className="inline-flex items-center gap-1 rounded-sm border border-emerald-700/40 bg-emerald-950/30 px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide text-emerald-400"
      >
        OCR
        {confidence != null && <span className="opacity-70">{confidence}</span>}
      </span>
    );
  }
  return (
    <span
      title="Filled by AI fallback. No exact location on the label — value was extracted from the full page image."
      className="inline-flex items-center gap-1 rounded-sm border border-sky-700/40 bg-sky-950/30 px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide text-sky-400"
    >
      AI
    </span>
  );
}

export function RulesSection({
  report,
  selectedFieldId,
  onSelect,
  provenance,
  bboxes,
}: {
  report: WireReport;
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
}) {
  const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const fields = report.fields;
  const crossCheck = report.crossCheck;
  const wineComparisons = getComparisons(crossCheck, WINE_COMPARISON_IDS);
  const visibleWineComparisons = wineComparisons.filter(shouldSurfaceWineComparison);
  const showWineRow = visibleWineComparisons.length > 0;
  const wineStatus = showWineRow
    ? statusFromComparisons(visibleWineComparisons)
    : null;
  const wineLabel = wineRuleLabel(visibleWineComparisons);

  // Close the open tooltip on outside click or Escape. The dialog is rendered
  // via a portal (to escape ancestor `overflow:clip`/stacking contexts), so
  // it lives outside `sectionRef`'s DOM subtree — `[data-cfr-tooltip]` is the
  // only marker we can rely on for "is this click inside the tooltip system."
  useEffect(() => {
    if (!openTooltipId) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as Element | null;
      const inside = target?.closest?.('[data-cfr-tooltip]');
      if (!inside) setOpenTooltipId(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpenTooltipId(null);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openTooltipId]);

  return (
    <section ref={sectionRef} className="rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">TTB label rules</h2>
          <p className="text-[11px] text-muted-foreground">
            Label requirements and only the app matches needed to assess them.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {RULE_DISPLAY_ORDER.map((ruleId) => {
            const rule = RULES.find((r) => r.id === ruleId);
            if (!rule) return null;
            const status = mergedRuleStatus(
              fields[rule.id]?.status ?? null,
              getComparisons(crossCheck, RULE_TO_COMPARISON_IDS[rule.id] ?? []),
            );
            return (
              <span
                key={rule.id}
                title={`${rule.label}: ${status ?? 'pending'}`}
                aria-label={`${rule.label}: ${status ?? 'pending'}`}
                className={cn('inline-block size-2.5 rounded-full', statusToDotColor(status))}
              />
            );
          })}
          {showWineRow && (
            <span
              title={`${wineLabel}: ${wineStatus ?? 'pending'}`}
              aria-label={`${wineLabel}: ${wineStatus ?? 'pending'}`}
              className={cn('inline-block size-2.5 rounded-full', statusToDotColor(wineStatus))}
            />
          )}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {RULE_DISPLAY_ORDER.map((ruleId) => {
          const rule = RULES.find((r) => r.id === ruleId);
          if (!rule) return null;
          const result = fields[rule.id];
          const comparisons = getComparisons(
            crossCheck,
            RULE_TO_COMPARISON_IDS[rule.id] ?? [],
          ).filter(shouldSurfaceComparison);
          const rowStatus = mergedRuleStatus(result?.status ?? null, comparisons);
          const path = RULE_TO_LABEL_PATH[rule.id] ?? null;
          const navigable = isFieldNavigable(path, provenance, bboxes);
          const low = isFieldLowConfidence(path, provenance, bboxes);
          const selected = path !== null && path === selectedFieldId;
          const source = fieldSource(path, provenance, bboxes);
          const tesseractConf = path ? bboxes?.[path]?.meanConfidence ?? null : null;
          return (
            <FragmentWithWineRow
              key={rule.id}
              ruleId={rule.id}
              showWineRow={showWineRow}
              wineComparisons={visibleWineComparisons}
              selectedFieldId={selectedFieldId}
              onSelect={onSelect}
              provenance={provenance}
              bboxes={bboxes}
              openTooltipId={openTooltipId}
              setOpenTooltipId={setOpenTooltipId}
            >
              <li className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <RuleIcon status={rowStatus} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => path && onSelect(path)}
                        disabled={!navigable}
                        aria-pressed={selected}
                        className={cn(
                          'min-w-0 text-left text-xs font-medium',
                          navigable
                            ? 'cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm'
                            : 'cursor-default',
                          selected && 'text-foreground',
                        )}
                      >
                        {rule.label}
                      </button>
                      <SourceBadge source={source} confidence={tesseractConf} />
                      <CfrTooltip
                        cfr={rule.cfr}
                        open={openTooltipId === rule.id}
                        onToggle={() =>
                          setOpenTooltipId((cur) => (cur === rule.id ? null : rule.id))
                        }
                      />
                    </div>
                    {result?.extractedValue && (
                      <p className="min-w-0 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        Label:{' '}
                        <span className="text-foreground/80">
                          {result.extractedValue}
                        </span>
                      </p>
                    )}
                    {result?.reason && result.status !== 'pass' && (
                      <p
                        className={cn(
                          'text-[11px] [overflow-wrap:anywhere]',
                          result.status === 'fail'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {result.reason}
                      </p>
                    )}
                    {comparisons.map((comparison) => (
                      <ComparisonNote
                        key={comparison.id}
                        comparison={comparison}
                        selectedFieldId={selectedFieldId}
                        onSelect={onSelect}
                        provenance={provenance}
                        bboxes={bboxes}
                        currentRuleLabelPath={path}
                      />
                    ))}
                  </div>
                  {low && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      Low
                    </span>
                  )}
                </div>
              </li>
            </FragmentWithWineRow>
          );
        })}
      </ul>
    </section>
  );
}

function getComparisons(
  crossCheck: WireReport['crossCheck'],
  ids: ReadonlyArray<CrossCheckFieldId>,
): CrossCheckFieldResult[] {
  if (!crossCheck) return [];
  return ids
    .map((id) => crossCheck.fields[id])
    .filter((field): field is CrossCheckFieldResult => Boolean(field));
}

function shouldSurfaceComparison(field: CrossCheckFieldResult): boolean {
  return field.status === 'mismatch' || field.status === 'not_on_label';
}

function shouldSurfaceWineComparison(field: CrossCheckFieldResult): boolean {
  return field.status !== 'not_applicable';
}

function wineRuleLabel(comparisons: ReadonlyArray<CrossCheckFieldResult>): string {
  const hasVarietal = comparisons.some((comparison) => comparison.id === 'wineVarietal');
  const hasAppellation = comparisons.some(
    (comparison) => comparison.id === 'wineAppellation',
  );
  if (hasVarietal && hasAppellation) return 'Wine varietal / appellation';
  if (hasVarietal) return CROSS_CHECK_FIELD_LABELS.wineVarietal;
  if (hasAppellation) return CROSS_CHECK_FIELD_LABELS.wineAppellation;
  return 'Wine details';
}

function mergedRuleStatus(
  ruleStatus: FieldStatus | null,
  comparisons: ReadonlyArray<CrossCheckFieldResult>,
): FieldStatus | null {
  if (ruleStatus === 'fail') return 'fail';
  if (ruleStatus === 'warn' || ruleStatus === 'uncertain') return ruleStatus;
  if (comparisons.some(shouldSurfaceComparison)) return 'warn';
  return ruleStatus;
}

function statusFromComparisons(
  comparisons: ReadonlyArray<CrossCheckFieldResult>,
): FieldStatus | null {
  if (comparisons.some(shouldSurfaceComparison)) return 'warn';
  if (comparisons.some((field) => field.status === 'match')) return 'pass';
  if (comparisons.some((field) => field.status === 'not_on_application')) return 'uncertain';
  return null;
}

function FragmentWithWineRow({
  children,
  ruleId,
  showWineRow,
  wineComparisons,
  selectedFieldId,
  onSelect,
  provenance,
  bboxes,
  openTooltipId,
  setOpenTooltipId,
}: {
  children: ReactNode;
  ruleId: string;
  showWineRow: boolean;
  wineComparisons: CrossCheckFieldResult[];
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
  openTooltipId: string | null;
  setOpenTooltipId: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <>
      {children}
      {ruleId === 'classType' && showWineRow && (
        <WineRuleRow
          comparisons={wineComparisons}
          selectedFieldId={selectedFieldId}
          onSelect={onSelect}
          provenance={provenance}
          bboxes={bboxes}
          open={openTooltipId === 'wine'}
          onToggle={() => setOpenTooltipId((cur) => (cur === 'wine' ? null : 'wine'))}
        />
      )}
    </>
  );
}

function WineRuleRow({
  comparisons,
  selectedFieldId,
  onSelect,
  provenance,
  bboxes,
  open,
  onToggle,
}: {
  comparisons: CrossCheckFieldResult[];
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
  open: boolean;
  onToggle(): void;
}) {
  const rowStatus = statusFromComparisons(comparisons);
  const rowLabel = wineRuleLabel(comparisons);
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <RuleIcon status={rowStatus} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs font-medium">{rowLabel}</span>
            <CfrTooltip cfr={WINE_CFR} open={open} onToggle={onToggle} />
          </div>
          <div className="mt-1 space-y-1">
            {comparisons.map((comparison) => (
              <ComparisonNote
                key={comparison.id}
                comparison={comparison}
                selectedFieldId={selectedFieldId}
                onSelect={onSelect}
                provenance={provenance}
                bboxes={bboxes}
                alwaysShowValues
                hideTitle={comparisons.length === 1}
              />
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function ComparisonNote({
  comparison,
  selectedFieldId,
  onSelect,
  provenance,
  bboxes,
  alwaysShowValues = false,
  currentRuleLabelPath = null,
  hideTitle = false,
}: {
  comparison: CrossCheckFieldResult;
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
  alwaysShowValues?: boolean;
  currentRuleLabelPath?: FieldPath | null;
  hideTitle?: boolean;
}) {
  const paths = COMPARISON_PATHS[comparison.id];
  const showValues = alwaysShowValues || comparison.status !== 'match';
  const labelIsAlreadyShown = paths.label !== null && paths.label === currentRuleLabelPath;
  const showTitle = !labelIsAlreadyShown && !hideTitle;
  const reason = comparisonReason(comparison, labelIsAlreadyShown);
  return (
    <div className="mt-1 min-w-0 max-w-full overflow-hidden rounded-md border border-border/70 bg-muted/20 px-2 py-1">
      {showTitle && (
        <div className="flex min-w-0 items-center gap-1.5">
          <ComparisonIcon status={comparison.status} />
          <span className="min-w-0 text-[11px] font-medium text-foreground/85 [overflow-wrap:anywhere]">
            {CROSS_CHECK_FIELD_LABELS[comparison.id]}
          </span>
        </div>
      )}
      {reason && (
        <p
          className={cn(
            'mt-0.5 min-w-0 text-[11px] [overflow-wrap:anywhere]',
            crossCheckStatusToReasonText(comparison.status),
          )}
        >
          {reason}
        </p>
      )}
      {showValues && (
        <div className="mt-1 grid gap-1">
          <ComparisonValue
            label="Application"
            value={comparison.applicationValue}
            path={paths.app}
            selectedFieldId={selectedFieldId}
            onSelect={onSelect}
            provenance={provenance}
            bboxes={bboxes}
          />
          {!labelIsAlreadyShown && (
            <ComparisonValue
              label="Label"
              value={comparison.labelValue}
              path={paths.label}
              selectedFieldId={selectedFieldId}
              onSelect={onSelect}
              provenance={provenance}
              bboxes={bboxes}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonValue({
  label,
  value,
  path,
  selectedFieldId,
  onSelect,
  provenance,
  bboxes,
}: {
  label: 'Application' | 'Label';
  value: string | null;
  path: FieldPath | null;
  selectedFieldId: FieldPath | null;
  onSelect(path: FieldPath | null): void;
  provenance: ProvenanceMap;
  bboxes?: FieldBboxes;
}) {
  const navigable = isFieldNavigable(path, provenance, bboxes);
  const selected = path !== null && path === selectedFieldId;
  const low = isFieldLowConfidence(path, provenance, bboxes);
  return (
    <button
      type="button"
      onClick={() => path && onSelect(path)}
      disabled={!navigable}
      aria-pressed={selected}
      className={cn(
        'grid w-full grid-cols-[4.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-sm px-1.5 py-0.5 text-left text-[11px]',
        navigable
          ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'cursor-default text-muted-foreground',
        selected && 'bg-accent/60',
      )}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="min-w-0 whitespace-normal text-foreground/85 [overflow-wrap:anywhere]">
        {value ?? '—'}
      </span>
      {low && (
        <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
          Low
        </span>
      )}
    </button>
  );
}

function CfrTooltip({
  cfr,
  open,
  onToggle,
}: {
  cfr: import('@/lib/validation/types').CfrCitation;
  open: boolean;
  onToggle(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <span className="inline-block" data-cfr-tooltip>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Show CFR citation: ${cfr.section}`}
        aria-expanded={open}
        onClick={onToggle}
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <ChevronUp className="size-3" /> : <Info className="size-3" />}
      </button>
      {open && <CfrTooltipDialog cfr={cfr} anchor={triggerRef} />}
    </span>
  );
}

/**
 * The popover dialog itself, rendered via a portal to document.body so it
 * escapes any ancestor `overflow:clip` and stacking contexts (the queue row
 * uses overflow:clip for rounded-card clipping; without the portal the
 * dialog gets cut off below the row). Positioned with `fixed` coordinates
 * derived from the trigger's bounding rect.
 */
function CfrTooltipDialog({
  cfr,
  anchor,
}: {
  cfr: import('@/lib/validation/types').CfrCitation;
  anchor: React.RefObject<HTMLButtonElement | null>;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Width must match the dialog's rendered width — used both as a Tailwind
  // class below and as the clamping constant here. 320 = w-80.
  const DIALOG_WIDTH = 320;
  const VIEWPORT_MARGIN = 8;

  // useLayoutEffect so the dialog never paints at (0,0) before being moved.
  useLayoutEffect(() => {
    function reposition(): void {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      // Prefer right-aligning the dialog with the trigger's right edge (so
      // it visually "hangs" from the ⓘ icon). Then clamp to the viewport so
      // the panel never disappears off the left/right edges.
      const idealLeft = rect.right - DIALOG_WIDTH;
      const maxLeft = window.innerWidth - DIALOG_WIDTH - VIEWPORT_MARGIN;
      const clampedLeft = Math.max(
        VIEWPORT_MARGIN,
        Math.min(idealLeft, maxLeft),
      );
      setCoords({ top: rect.bottom + 4, left: clampedLeft });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchor]);

  if (!coords) return null;
  return createPortal(
    <div
      role="dialog"
      aria-label={cfr.section}
      data-cfr-tooltip
      style={{ position: 'fixed', top: coords.top, left: coords.left }}
      className="z-50 w-80 rounded-md border border-border bg-popover p-3 text-[11px] shadow-md"
    >
      <p className="font-semibold text-foreground">{cfr.section}</p>
      <p className="mt-1 text-foreground/80">{cfr.summary}</p>
      <p className="mt-2 border-l-2 border-border pl-2 italic text-muted-foreground">
        {cfr.quote}
      </p>
    </div>,
    document.body,
  );
}

function ComparisonIcon({ status }: { status: CrossCheckFieldResult['status'] }) {
  if (status === 'match') return <Check className="size-3.5 text-emerald-600" />;
  if (status === 'mismatch') return <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />;
  if (status === 'not_on_label') return <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />;
  if (status === 'not_on_application') return <Info className="size-3.5 text-sky-600" />;
  return <HelpCircle className="size-3.5 text-muted-foreground" />;
}

function RuleIcon({ status }: { status: FieldStatus | null }) {
  if (status === 'pass') return <Check className="mt-0.5 size-3.5 text-emerald-600" />;
  if (status === 'fail') return <X className="mt-0.5 size-3.5 text-rose-600" />;
  if (status === 'warn' || status === 'uncertain')
    return <AlertTriangle className="mt-0.5 size-3.5 text-amber-600 dark:text-amber-400" />;
  return <HelpCircle className="mt-0.5 size-3.5 text-muted-foreground" />;
}

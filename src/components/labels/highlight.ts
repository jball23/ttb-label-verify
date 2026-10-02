import { type CorrectableField } from '@/lib/labels/corrections';

export type OnHighlight = (field: CorrectableField | null) => void;

/** Hover or keyboard focus shows the field on the photo; leaving clears it. */
export function highlightHandlers(field: CorrectableField, onHighlight: OnHighlight) {
  return {
    onMouseEnter: () => onHighlight(field),
    onMouseLeave: () => onHighlight(null),
    onFocus: () => onHighlight(field),
    onBlur: () => onHighlight(null),
  };
}

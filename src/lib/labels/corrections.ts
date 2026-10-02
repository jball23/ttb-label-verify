import { z } from 'zod';
import { LABEL_FIELD_IDS, type LabelReading } from './reading';

/**
 * A reviewer's fix to what the reader got wrong. Corrections are kept apart
 * from the reading so the original AI output is never lost, and each one
 * records who made it and when.
 */
export const CORRECTABLE_FIELDS = [...LABEL_FIELD_IDS, 'governmentWarning'] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface Correction {
  /** What the label actually says, per the reviewer; null = not on the label. */
  value: string | null;
  correctedAt: string;
  reviewer: string | null;
}

export type Corrections = Partial<Record<CorrectableField, Correction>>;

/** What a client sends: the full set of corrected values it wants in place. */
export const CorrectionValuesSchema = z
  .object(
    Object.fromEntries(
      CORRECTABLE_FIELDS.map((field) => [
        field,
        z.string().max(2000).nullable().optional(),
      ]),
    ) as Record<CorrectableField, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
  )
  .strict();

export type CorrectionValues = z.infer<typeof CorrectionValuesSchema>;

/** The reading the rules should judge: the AI reading with corrections applied. */
export function applyCorrections(
  reading: LabelReading,
  corrections: Corrections,
): LabelReading {
  const fields = { ...reading.fields };
  for (const field of LABEL_FIELD_IDS) {
    const correction = corrections[field];
    // A person has looked, so the reading is no longer uncertain.
    if (correction) fields[field] = { value: correction.value, confidence: 'high' };
  }
  const warning = corrections.governmentWarning;
  return {
    ...reading,
    fields,
    governmentWarning: warning
      ? { ...reading.governmentWarning, verbatimText: warning.value }
      : reading.governmentWarning,
  };
}

/**
 * Turns requested values into stored corrections. An unchanged value keeps
 * its original timestamp and reviewer. A value equal to the AI reading is
 * kept too: it records that a person confirmed an unsure reading.
 */
export function reconcileCorrections(
  previous: Corrections,
  requested: CorrectionValues,
  stamp: { at: Date; reviewer: string | null },
): Corrections {
  const next: Corrections = {};
  for (const field of CORRECTABLE_FIELDS) {
    if (!(field in requested)) continue;
    const value = normalize(requested[field]);
    const kept = previous[field];
    next[field] =
      kept && kept.value === value
        ? kept
        : { value, correctedAt: stamp.at.toISOString(), reviewer: stamp.reviewer };
  }
  return next;
}

/** True when the reviewer kept the AI's value, i.e. confirmed rather than changed it. */
export function isConfirmation(
  reading: LabelReading,
  field: CorrectableField,
  correction: Correction,
): boolean {
  return normalize(correction.value) === normalize(originalValue(reading, field));
}

export function originalValue(
  reading: LabelReading,
  field: CorrectableField,
): string | null {
  return field === 'governmentWarning'
    ? reading.governmentWarning.verbatimText
    : reading.fields[field].value;
}

function normalize(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

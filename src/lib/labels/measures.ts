/**
 * Parsers for the two numeric label statements. Shared by the label rules
 * (is the statement in a recognizable form?) and the expected-value
 * comparisons (does it equal what the application says?).
 */

const PERCENT_RE = /(\d{1,2}(?:\.\d{1,2})?)\s*%/;
const PROOF_RE = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:°\s*)?proof\b/i;
const BARE_NUMBER_RE = /^\s*(\d{1,2}(?:\.\d{1,2})?)\s*$/;

/** True when the statement includes a percentage, e.g. "45% Alc./Vol.". */
export function statesAlcoholPercent(text: string | null | undefined): boolean {
  return !!text && PERCENT_RE.test(text);
}

/**
 * Alcohol by volume as a number, from "45% Alc./Vol. (90 Proof)", "45%",
 * "90 Proof" (→ 45) or a bare "45". Null when no amount can be found.
 */
export function parseAlcoholPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const percent = PERCENT_RE.exec(text);
  if (percent) return Number(percent[1]);
  const proof = PROOF_RE.exec(text);
  if (proof) return Number(proof[1]) / 2;
  const bare = BARE_NUMBER_RE.exec(text);
  return bare ? Number(bare[1]) : null;
}

const VOLUME_UNITS_ML: ReadonlyArray<[RegExp, number]> = [
  [/^(?:ml|milliliters?|millilitres?)$/i, 1],
  [/^(?:cl|centiliters?|centilitres?)$/i, 10],
  [/^(?:l|liters?|litres?)$/i, 1000],
  [/^(?:fl\.?\s*oz\.?|fluid\s+ounces?|oz\.?)$/i, 29.5735],
];

const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(ml|milliliters?|millilitres?|cl|centiliters?|centilitres?|liters?|litres?|l|fl\.?\s*oz\.?|fluid\s+ounces?|oz\.?)(?![a-z])/i;

/** Net contents in millilitres, from "750 mL", "75 cL", "1 L", "12 FL OZ". */
export function parseVolumeMl(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = VOLUME_RE.exec(text);
  if (!match) return null;
  const amount = Number(match[1]!.replace(',', '.'));
  const unit = match[2]!.replace(/\s+/g, ' ');
  const factor = VOLUME_UNITS_ML.find(([re]) => re.test(unit))?.[1];
  return factor === undefined ? null : amount * factor;
}

/** True when two amounts agree within a relative tolerance. */
export function amountsAgree(a: number, b: number, relativeTolerance = 0.005): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * relativeTolerance;
}

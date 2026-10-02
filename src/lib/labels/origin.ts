import { canonicalCountry, STATE_NAME_TO_CODE } from './normalize';
import { type LabelReading } from './reading';

/**
 * Where a product comes from, working from what the label actually says.
 * Domestic labels rarely state a country, but their bottler's address does:
 * "Portland, Oregon" means the United States.
 */
export interface Origin {
  /** The country, stated or inferred; null when it cannot be told. */
  country: string | null;
  how: 'stated' | 'address' | 'unknown';
  /** The place on the label the country was inferred from, e.g. "Portland, Oregon". */
  place: string | null;
  /** The label names an importer ("Imported by …"). */
  imported: boolean;
  /** The product comes from outside the United States, by its stated country. */
  foreign: boolean;
}

export const UNITED_STATES = 'United States';

/** Products of US territories are domestic for TTB labeling. */
const US_TERRITORIES = [
  'district of columbia',
  'puerto rico',
  'guam',
  'u.s. virgin islands',
  'us virgin islands',
  'american samoa',
  'northern mariana islands',
];

const PLACE_NAMES = [...Object.keys(STATE_NAME_TO_CODE), ...US_TERRITORIES].sort(
  (a, b) => b.length - a.length, // "west virginia" before "virginia"
);
const PLACE_NAME_RE = new RegExp(`\\b(${PLACE_NAMES.map(escape).join('|')})\\b`, 'i');
const STATE_CODES = new Set(
  Object.values(STATE_NAME_TO_CODE).map((c) => c.toUpperCase()),
);
// "Bardstown, KY" or "Bardstown, KY 40004": a capitalized code after a comma.
const STATE_CODE_RE = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\b/;
const IMPORTED_BY_RE = /\bimported\s+by\b/i;

export function inferOrigin(reading: LabelReading): Origin {
  const stated = reading.fields.countryOfOrigin.value?.trim() || null;
  const producer = reading.fields.producer.value ?? '';
  const imported =
    !!reading.fields.importer?.value?.trim() || IMPORTED_BY_RE.test(producer);
  if (stated) {
    const foreign = canonicalCountry(stated) !== 'usa';
    return { country: stated, how: 'stated', place: null, imported, foreign };
  }
  // An importer's US address says nothing about where the product was made.
  const place = imported ? null : findUsPlace(producer);
  if (place) {
    return { country: UNITED_STATES, how: 'address', place, imported, foreign: false };
  }
  return { country: null, how: 'unknown', place: null, imported, foreign: false };
}

/**
 * The US place named in an address, as printed ("Portland, Oregon",
 * "Bardstown, KY"), with the town before it when there is one.
 */
export function findUsPlace(address: string): string | null {
  const segments = address
    .split(/[,·•|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    const byName = PLACE_NAME_RE.exec(segment);
    if (byName) return withTown(segments, index, byName[0]);
  }
  const byCode = STATE_CODE_RE.exec(address);
  if (byCode && STATE_CODES.has(byCode[1]!)) {
    const before = address
      .slice(0, byCode.index)
      .split(/[,·•|\n]/)
      .pop()
      ?.trim();
    return before ? `${before}, ${byCode[1]}` : byCode[1]!;
  }
  return null;
}

function withTown(segments: string[], index: number, place: string): string {
  const town = segments[index - 1];
  // "Bottled by Old Tom Distillery" is not a town; a town is a short name.
  return town && town.split(/\s+/).length <= 3 && !/\bby\b/i.test(town)
    ? `${town}, ${place}`
    : place;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

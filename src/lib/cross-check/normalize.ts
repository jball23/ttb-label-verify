/**
 * String comparators used by the cross-check engine. All deterministic; no LLM
 * in this path. Tunable in one place so the engine itself stays declarative.
 *
 * - `normalizedExact`: brand / class-type / varietal / appellation
 * - `producerMatches`: token-set Jaccard ≥ threshold against the freeform
 *   producer string the extractor returns
 * - `countryMatches`: normalized exact with a US/USA/United States alias map
 * - `classTypeMatches`: normalized exact OR an alias map for compact TTB
 *   categories (e.g. "IPA" ⇄ "India Pale Ale")
 */

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
};

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'usa',
  us: 'usa',
  'u.s.': 'usa',
  'u.s.a.': 'usa',
  'united states': 'usa',
  'united states of america': 'usa',
  america: 'usa',
};

// Compact aliases for the class/type designation. Maps free-form label
// designations to the canonical TTB category text used on the COLA form.
const CLASS_TYPE_ALIASES: Record<string, string[]> = {
  // Whiskey family — all reduce to "whiskey" so a "bourbon" label matches a
  // "kentucky straight bourbon whiskey" application or vice versa.
  bourbon: ['bourbon', 'bourbon whiskey', 'kentucky straight bourbon whiskey'],
  whiskey: ['whiskey', 'whisky'],
  // Beer / malt beverage family
  ipa: ['ipa', 'india pale ale'],
  'pale ale': ['pale ale', 'ipa', 'india pale ale'],
  ale: ['ale'],
  lager: ['lager'],
  beer: ['beer', 'malt beverages'],
  'malt beverages': ['malt beverages', 'beer'],
  // Spirits family
  vodka: ['vodka'],
  rum: ['rum'],
  gin: ['gin'],
  tequila: ['tequila'],
  'distilled spirits': ['distilled spirits', 'spirits'],
};

const CORPORATE_SUFFIX_RE =
  /\b(l\.?l\.?c\.?|inc\.?|corp\.?|co\.?|ltd\.?|company|incorporated|llp)\b\.?/g;

const PRODUCER_NOISE_TOKENS = new Set([
  'the',
  'of',
  'and',
  'by',
  'a',
  'an',
  '·',
  '-',
]);

const PRODUCER_PROCESS_TOKENS = new Set([
  'distilled',
  'bottled',
  'brewed',
  'canned',
  'produced',
  'imported',
  'blended',
  'packed',
  'fermented',
]);

const PRODUCER_MATCH_THRESHOLD = 0.4;

function casefold(s: string): string {
  return s.toLowerCase();
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripCorporateSuffix(s: string): string {
  return s.replace(CORPORATE_SUFFIX_RE, '');
}

/**
 * Lossy normalization for casefold-exact comparison. Strips corporate suffixes
 * because "Ridge Creek Distillery" on the label should match "Ridge Creek
 * Distillery, LLC" on the form.
 */
export function normalizedExact(value: string | null | undefined): string {
  if (value == null) return '';
  return collapseWhitespace(
    stripCorporateSuffix(stripDiacritics(casefold(value))),
  );
}

/**
 * Tokenize a freeform producer/address string into a comparable token set.
 * Strips punctuation, casefolds, expands state names to codes (so "Kentucky"
 * matches "KY"), and removes noise + corporate suffix words.
 */
export function tokenize(value: string | null | undefined): Set<string> {
  if (value == null) return new Set();
  const cleaned = stripDiacritics(casefold(value));
  const replaced = expandStateNames(cleaned);
  const rawTokens = replaced
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const result = new Set<string>();
  for (const t of rawTokens) {
    if (PRODUCER_NOISE_TOKENS.has(t)) continue;
    if (PRODUCER_PROCESS_TOKENS.has(t)) continue;
    if (/^(l|llc|inc|corp|co|ltd|company|incorporated|llp)$/.test(t)) continue;
    result.add(t);
  }
  return result;
}

function expandStateNames(s: string): string {
  let out = s;
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    out = out.replace(re, code);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set<string>();
  for (const t of a) if (b.has(t)) intersection.add(t);
  const union = new Set<string>([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * Producer match: token-set Jaccard ≥ 0.4 with the freeform producer string
 * returned by the extractor. Designed so scenario 01's
 *   "Ridge Creek Distillery, LLC, Bardstown, KY"  vs
 *   "Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky"
 * is a match, and scenario 05's
 *   "Calypso Sands Distilling, Inc., Miami, FL"  vs
 *   "Bottled by Tropical Spirits LLC · San Juan, Puerto Rico"
 * is a mismatch.
 */
export function producerMatches(
  applicationValue: string,
  labelValue: string,
): boolean {
  const appTokens = tokenize(applicationValue);
  const labelTokens = tokenize(labelValue);
  return jaccard(appTokens, labelTokens) >= PRODUCER_MATCH_THRESHOLD;
}

/**
 * Country match: normalized exact with USA aliases.
 */
export function countryMatches(
  applicationValue: string,
  labelValue: string,
): boolean {
  const appNorm = COUNTRY_ALIASES[normalizedExact(applicationValue)] ?? normalizedExact(applicationValue);
  const labelNorm = COUNTRY_ALIASES[normalizedExact(labelValue)] ?? normalizedExact(labelValue);
  return appNorm === labelNorm;
}

/**
 * Class/type match: normalized exact OR alias-equivalent OR bidirectional
 * token containment (label's tokens ⊆ app's tokens or vice versa, after
 * normalization).
 */
export function classTypeMatches(
  applicationValue: string,
  labelValue: string,
): boolean {
  const appNorm = normalizedExact(applicationValue);
  const labelNorm = normalizedExact(labelValue);
  if (appNorm === labelNorm) return true;
  if (aliasEquivalent(appNorm, labelNorm)) return true;
  // Bidirectional token containment: label "Hop Forge IPA" contains "ipa";
  // application "India Pale Ale" expanded via alias matches "ipa" tokens.
  return tokenContainment(appNorm, labelNorm);
}

function aliasEquivalent(a: string, b: string): boolean {
  for (const family of Object.values(CLASS_TYPE_ALIASES)) {
    if (family.includes(a) && family.includes(b)) return true;
  }
  return false;
}

function tokenContainment(a: string, b: string): boolean {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  // Expand each token through aliases (so 'ipa' ⇄ 'india', 'pale', 'ale').
  const aExpanded = expandTokens(aTokens);
  const bExpanded = expandTokens(bTokens);
  return isSubset(aExpanded, bExpanded) || isSubset(bExpanded, aExpanded);
}

function expandTokens(tokens: Set<string>): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const family of Object.values(CLASS_TYPE_ALIASES)) {
      if (family.includes(t)) for (const m of family) for (const word of m.split(/\s+/)) out.add(word);
    }
  }
  return out;
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

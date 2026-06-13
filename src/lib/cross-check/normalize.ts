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
import {
  canonicalWineAppellation,
  canonicalWineVarietal,
  isWineTypeOnly,
} from '../wine/lexicon';

export type ProductFamily = 'WINE' | 'DISTILLED SPIRITS' | 'MALT BEVERAGES';

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

const US_STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'usa',
  us: 'usa',
  'u.s.': 'usa',
  'u.s.a.': 'usa',
  'united states': 'usa',
  'united states of america': 'usa',
  america: 'usa',
};

const WINE_NO_DECLARATION_VALUES = new Set([
  '',
  '-',
  'n/a',
  'na',
  'none',
  'not applicable',
  'null',
]);

// Compact aliases for the Fanciful name. Maps free-form label
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
  'on',
  'used',
  'label',
  'dba',
  'tradename',
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
  return collapseWhitespace(stripCorporateSuffix(stripDiacritics(casefold(value))));
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
export function producerMatches(applicationValue: string, labelValue: string): boolean {
  const appTokens = tokenize(applicationValue);
  const labelTokens = tokenize(labelValue);
  if (appTokens.size >= 2 && isSubset(appTokens, labelTokens)) return true;
  if (labelTokens.size >= 2 && isSubset(labelTokens, appTokens)) return true;
  for (const line of applicationValue.split(/\n+/)) {
    const lineTokens = tokenize(line);
    if (lineTokens.size >= 2 && isSubset(lineTokens, labelTokens)) return true;
  }
  return jaccard(appTokens, labelTokens) >= PRODUCER_MATCH_THRESHOLD;
}

export function producerImpliesDomesticOrigin(value: string | null | undefined): boolean {
  if (!value || /^\s*imported\s+by\b/i.test(value)) return false;
  const tokens = tokenize(value);
  for (const token of tokens) {
    if (US_STATE_CODES.has(token)) return true;
  }
  return false;
}

/**
 * Country match: normalized exact with USA aliases.
 *
 * Special case: when the application declares "IMPORTED" (synthesized from
 * Item 3's Imported checkbox), the form does NOT specify a country — it
 * only says the product is foreign-sourced. Treat any non-USA label
 * country as a match in that case. TTB approves labels with a specific
 * foreign country (Mexico, Germany, France, etc.) against Imported
 * applications all the time; they aren't a compliance failure.
 */
export function countryMatches(applicationValue: string, labelValue: string): boolean {
  const appNorm =
    COUNTRY_ALIASES[normalizeCountryValue(applicationValue)] ??
    normalizeCountryValue(applicationValue);
  const labelNorm =
    COUNTRY_ALIASES[normalizeCountryValue(labelValue)] ?? normalizeCountryValue(labelValue);
  if (appNorm === 'imported') return labelNorm !== 'usa' && labelNorm.length > 0;
  return appNorm === labelNorm;
}

function normalizeCountryValue(value: string): string {
  return normalizedExact(value)
    .replace(/^(?:product|produce|made)\s+of\s+/, '')
    .replace(/^country\s+of\s+origin\s+/, '')
    .trim();
}

export function isNoWineDeclaration(value: string | null | undefined): boolean {
  return WINE_NO_DECLARATION_VALUES.has(normalizedExact(value));
}

export function normalizeWineVarietalClaim(
  value: string | null | undefined,
): string | null {
  const normalized = normalizedExact(value);
  if (WINE_NO_DECLARATION_VALUES.has(normalized)) return null;
  if (isWineTypeOnly(value)) return null;
  return canonicalWineVarietal(value);
}

export function normalizeWineAppellationClaim(
  value: string | null | undefined,
): string | null {
  if (isNoWineDeclaration(value)) return null;
  const canonical = canonicalWineAppellation(value);
  if (canonical) return canonical;
  if (isWineTypeOnly(value)) return null;
  return value?.trim() || null;
}

/**
 * Class/type match: normalized exact OR alias-equivalent OR bidirectional
 * token containment (label's tokens ⊆ app's tokens or vice versa, after
 * normalization).
 */
export function classTypeMatches(applicationValue: string, labelValue: string): boolean {
  const appNorm = normalizedExact(applicationValue);
  const labelNorm = normalizedExact(labelValue);
  if (appNorm === labelNorm) return true;

  const appFamily = inferProductFamilyFromText(applicationValue);
  const labelFamily = inferProductFamilyFromText(labelValue);
  if (appFamily && isProductFamilyValue(appNorm)) {
    return labelFamily === appFamily;
  }

  if (aliasEquivalent(appNorm, labelNorm)) return true;
  // Bidirectional token containment: label "Hop Forge IPA" contains "ipa";
  // application "India Pale Ale" expanded via alias matches "ipa" tokens.
  return tokenContainment(appNorm, labelNorm);
}

export function inferProductFamilyFromText(
  value: string | null | undefined,
): ProductFamily | null {
  if (!value) return null;
  const normalized = normalizedExact(value);
  if (!normalized) return null;
  const wineHit =
    /\b(?:wine|port|sherry|vermouth|champagne|riesling|chardonnay|cabernet|merlot|pinot|sauvignon|moscato|zinfandel|barbera|syrah|shiraz|malbec)\b/.test(
      normalized,
    ) ||
    canonicalWineVarietal(value) != null ||
    isWineTypeOnly(value);
  const maltHit =
    /\b(?:malt|beer|ale|lager|stout|porter|ipa|pilsner|weisse|saison)\b/.test(
      normalized,
    );
  const spiritsHit =
    /\b(?:spirits?|whiskey|whisky|vodka|rum|gin|tequila|bourbon|brandy|cognac|mezcal|liqueur|cordial|schnapps|absinthe|amaro|aquavit|ouzo|sotol|pisco|grappa|distilled|blanco|reposado|anejo)\b/.test(
      normalized,
    );
  const families: ProductFamily[] = [];
  if (wineHit) families.push('WINE');
  if (maltHit) families.push('MALT BEVERAGES');
  if (spiritsHit) families.push('DISTILLED SPIRITS');
  return families.length === 1 ? families[0]! : null;
}

function isProductFamilyValue(normalized: string): boolean {
  return (
    normalized === 'wine' ||
    normalized === 'distilled spirits' ||
    normalized === 'malt beverages'
  );
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
      if (family.includes(t))
        for (const m of family) for (const word of m.split(/\s+/)) out.add(word);
    }
  }
  return out;
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * Deterministic wine vocabulary used to keep grape-varietal extraction from
 * drifting into class/type phrases such as "white wine blend".
 *
 * Seeded from common TTB-approved grape names/synonyms and common appellation
 * forms. The matcher is intentionally strict for varietals: a value only
 * survives as a grape claim when it contains a known grape name.
 */

export type WineLexiconMatch = {
  canonical: string;
  matched: string;
};

type Entry = {
  canonical: string;
  aliases?: string[];
};

const GRAPE_VARIETY_ENTRIES: Entry[] = [
  { canonical: 'Agiorgitiko' },
  { canonical: 'Albariño', aliases: ['Albarino'] },
  { canonical: 'Alicante Bouschet' },
  { canonical: 'Aligoté', aliases: ['Aligote'] },
  { canonical: 'Arneis' },
  { canonical: 'Baga' },
  { canonical: 'Barbera' },
  { canonical: 'Blaufränkisch', aliases: ['Blaufrankisch', 'Lemberger'] },
  { canonical: 'Cabernet Franc' },
  { canonical: 'Cabernet Sauvignon' },
  { canonical: 'Carménère', aliases: ['Carmenere'] },
  { canonical: 'Carignan', aliases: ['Carignane'] },
  { canonical: 'Catawba' },
  { canonical: 'Chambourcin' },
  { canonical: 'Chancellor' },
  { canonical: 'Charbono' },
  { canonical: 'Chardonnay' },
  { canonical: 'Chenin Blanc' },
  { canonical: 'Cinsaut', aliases: ['Cinsault'] },
  { canonical: 'Clarion' },
  { canonical: 'Colombard', aliases: ['French Colombard'] },
  { canonical: 'Colorino', aliases: ['Lambrusco Colorino'] },
  { canonical: 'Concord' },
  { canonical: 'Corvina' },
  { canonical: 'Counoise' },
  { canonical: 'Dolcetto' },
  { canonical: 'Durif', aliases: ['Petite Sirah', 'Petite Syrah'] },
  { canonical: 'Fiano' },
  { canonical: 'Frontenac' },
  { canonical: 'Gamay' },
  { canonical: 'Gewürztraminer', aliases: ['Gewurztraminer'] },
  { canonical: 'Greco Bianco' },
  { canonical: 'Grenache', aliases: ['Garnacha'] },
  { canonical: 'Grenache Blanc', aliases: ['Garnacha Blanca'] },
  { canonical: 'Grenache Gris', aliases: ['Garnacha Roja'] },
  { canonical: 'Grüner Veltliner', aliases: ['Gruner Veltliner'] },
  { canonical: 'Malbec' },
  { canonical: 'Malmsey' },
  { canonical: 'Marquette' },
  { canonical: 'Marsanne' },
  { canonical: 'Melon' },
  { canonical: 'Merlot' },
  { canonical: 'Mourvèdre', aliases: ['Mourvedre', 'Mataro', 'Monastrell'] },
  { canonical: 'Müller-Thurgau', aliases: ['Muller Thurgau', 'Mueller Thurgau'] },
  { canonical: 'Muscat', aliases: ['Moscato', 'Muscat Blanc', 'Muscat Canelli'] },
  { canonical: 'Muscadelle' },
  { canonical: 'Nebbiolo' },
  { canonical: 'Niagara' },
  { canonical: 'Norton', aliases: ['Cynthiana'] },
  { canonical: 'Palomino' },
  { canonical: 'Pecorino' },
  { canonical: 'Petit Verdot' },
  { canonical: 'Picpoul Blanc', aliases: ['Piquepoul Blanc'] },
  { canonical: 'Pinot Blanc' },
  { canonical: 'Pinot Gris', aliases: ['Pinot Grigio'] },
  { canonical: 'Pinot Meunier', aliases: ['Meunier'] },
  { canonical: 'Pinot Noir' },
  { canonical: 'Primitivo' },
  { canonical: 'Riesling' },
  { canonical: 'Roussanne' },
  { canonical: 'Ruby Cabernet' },
  { canonical: 'Sangiovese' },
  { canonical: 'Sauvignon Blanc', aliases: ['Fumé Blanc', 'Fume Blanc'] },
  { canonical: 'Sémillon', aliases: ['Semillon'] },
  { canonical: 'Seyval Blanc' },
  { canonical: 'St. Croix', aliases: ['Saint Croix'] },
  { canonical: 'Syrah', aliases: ['Shiraz'] },
  { canonical: 'Tannat' },
  { canonical: 'Tempranillo' },
  { canonical: 'Teroldego' },
  { canonical: 'Tinta Amarela', aliases: ['Trincadeira'] },
  { canonical: 'Tinta Cão', aliases: ['Tinta Cao'] },
  { canonical: 'Tinto Cão', aliases: ['Tinto Cao'] },
  { canonical: 'Touriga Franca', aliases: ['Touriga Francesa'] },
  { canonical: 'Touriga Nacional' },
  { canonical: 'Traminette' },
  { canonical: 'Trebbiano', aliases: ['Ugni Blanc'] },
  { canonical: 'Valdiguié', aliases: ['Valdiguie', 'Napa Gamay'] },
  { canonical: 'Verdejo' },
  { canonical: 'Verdelho' },
  { canonical: 'Verdicchio' },
  { canonical: 'Vermentino', aliases: ['Rolle'] },
  { canonical: 'Vidal Blanc' },
  { canonical: 'Vignoles', aliases: ['Ravat 51'] },
  { canonical: 'Viognier' },
  { canonical: 'Zinfandel' },
  { canonical: 'Zweigelt' },
];

const COMMON_US_AVAS = [
  'American',
  'Applegate Valley',
  'Arroyo Grande Valley',
  'Arroyo Seco',
  'Atlas Peak',
  'Augusta',
  'Ballard Canyon',
  'Calistoga',
  'California',
  'Carneros',
  'Central Coast',
  'Chalk Hill',
  'Chalone',
  'Columbia Gorge',
  'Columbia Valley',
  'Coombsville',
  'Dry Creek Valley',
  'Dundee Hills',
  'Edna Valley',
  'El Dorado',
  'Eola-Amity Hills',
  'Finger Lakes',
  'Happy Canyon of Santa Barbara',
  'High Valley',
  'Horse Heaven Hills',
  'Howell Mountain',
  'Knights Valley',
  'Lake Michigan Shore',
  'Livermore Valley',
  'Lodi',
  'Los Carneros',
  'Mendocino',
  'Monterey',
  'Mt. Harlan',
  'Napa Valley',
  'North Coast',
  'Oak Knoll District',
  'Oakville',
  'Paso Robles',
  'Red Hills Lake County',
  'Red Mountain',
  'Ribbon Ridge',
  'Rockpile',
  'Rogue Valley',
  'Russian River Valley',
  'Rutherford',
  'Santa Barbara County',
  'Santa Cruz Mountains',
  'Santa Lucia Highlands',
  'Santa Maria Valley',
  'Santa Rita Hills',
  'Santa Ynez Valley',
  'Seneca Lake',
  'Shenandoah Valley',
  'Sierra Foothills',
  'Snipes Mountain',
  'Sonoma Coast',
  'Sonoma County',
  'Sonoma Mountain',
  'Sonoma Valley',
  'Spring Mountain District',
  'Stags Leap District',
  'Sta. Rita Hills',
  'Suisun Valley',
  'Umpqua Valley',
  'Wahluke Slope',
  'Walla Walla Valley',
  'Willamette Valley',
  'Yakima Valley',
  'Yamhill-Carlton',
] as const;

const US_STATES = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
] as const;

const APPELLATION_ENTRIES: Entry[] = [
  { canonical: 'American', aliases: ['USA', 'U.S.A.', 'United States', 'United States of America'] },
  ...US_STATES.map((canonical) => ({ canonical })),
  ...COMMON_US_AVAS.map((canonical) => ({ canonical })),
  { canonical: 'Argentina' },
  { canonical: 'Australia' },
  { canonical: 'Austria' },
  { canonical: 'Bordeaux' },
  { canonical: 'Bourgogne', aliases: ['Burgundy'] },
  { canonical: 'Canada' },
  { canonical: 'Chile' },
  { canonical: 'France' },
  { canonical: 'Germany' },
  { canonical: 'Italy' },
  { canonical: 'Marlborough' },
  { canonical: 'Mendoza' },
  { canonical: 'Mexico' },
  { canonical: 'New Zealand' },
  { canonical: 'Portugal' },
  { canonical: 'Rioja' },
  { canonical: 'South Africa' },
  { canonical: 'Spain' },
];

const WINE_TYPE_ONLY_PATTERNS = [
  /\b(?:red|white|rose|rosé|pink)\s+wine\s+blend\b/,
  /\b(?:red|white|rose|rosé|pink)\s+blend\b/,
  /\b(?:sweet|dry|semi dry|semi-dry)\s+(?:red|white|rose|rosé|pink)\b/,
  /\b(?:table|dessert|sparkling|carbonated|fruit|honey|rice)\s+wine\b/,
  /\b(?:hard cider|cider|mead|sake)\b/,
];

const VARIETAL_MATCHERS = buildMatchers(GRAPE_VARIETY_ENTRIES);
const APPELLATION_MATCHERS = buildMatchers(APPELLATION_ENTRIES);

export function normalizeWineLexiconText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findWineVarietals(value: string | null | undefined): WineLexiconMatch[] {
  return findMatches(value, VARIETAL_MATCHERS);
}

export function findWineAppellations(value: string | null | undefined): WineLexiconMatch[] {
  return findMatches(value, APPELLATION_MATCHERS);
}

export function canonicalWineVarietal(value: string | null | undefined): string | null {
  const matches = findWineVarietals(value);
  if (matches.length === 0) return null;
  return uniqueCanonicals(matches).join(', ');
}

export function canonicalWineAppellation(value: string | null | undefined): string | null {
  const matches = findWineAppellations(value);
  if (matches.length === 0) return null;
  return matches[0]?.canonical ?? null;
}

export function isWineTypeOnly(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeWineLexiconText(value);
  return WINE_TYPE_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildMatchers(entries: Entry[]): Array<WineLexiconMatch & { key: string; re: RegExp }> {
  return entries
    .flatMap((entry) => {
      const names = [entry.canonical, ...(entry.aliases ?? [])];
      return names.map((name) => {
        const key = normalizeWineLexiconText(name);
        return {
          canonical: entry.canonical,
          matched: name,
          key,
          re: new RegExp(`(?:^|\\s)${escapeRegExp(key)}(?:\\s|$)`),
        };
      });
    })
    .sort((a, b) => b.key.length - a.key.length);
}

function findMatches(
  value: string | null | undefined,
  matchers: Array<WineLexiconMatch & { key: string; re: RegExp }>,
): WineLexiconMatch[] {
  if (!value) return [];
  const normalized = normalizeWineLexiconText(value);
  if (!normalized) return [];
  const seen = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  const matches: WineLexiconMatch[] = [];
  for (const matcher of matchers) {
    const found = matcher.re.exec(normalized);
    if (!found) continue;
    const leadingSpace = found[0].startsWith(' ') ? 1 : 0;
    const start = found.index + leadingSpace;
    const end = start + matcher.key.length;
    if (ranges.some((range) => start < range.end && end > range.start)) continue;
    if (seen.has(matcher.canonical)) continue;
    seen.add(matcher.canonical);
    ranges.push({ start, end });
    matches.push({ canonical: matcher.canonical, matched: matcher.matched });
  }
  return matches;
}

function uniqueCanonicals(matches: WineLexiconMatch[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    if (seen.has(match.canonical)) continue;
    seen.add(match.canonical);
    result.push(match.canonical);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

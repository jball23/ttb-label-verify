import { describe, it, expect } from 'vitest';
import {
  normalizedExact,
  tokenize,
  producerMatches,
  countryMatches,
  classTypeMatches,
  normalizeWineVarietalClaim,
  normalizeWineAppellationClaim,
  producerImpliesDomesticOrigin,
} from './normalize';

describe('normalizedExact', () => {
  it('casefolds and trims', () => {
    expect(normalizedExact('  Ridge Creek  ')).toBe('ridge creek');
  });

  it('strips corporate suffixes', () => {
    expect(normalizedExact('Ridge Creek Distillery, LLC')).toBe(
      'ridge creek distillery,',
    );
    expect(normalizedExact('Hawthorne Cellars, Inc.')).toBe(
      'hawthorne cellars,',
    );
  });

  it('distinguishes brand names that differ by extra words (scenario 02)', () => {
    expect(normalizedExact('Silver Birch')).not.toBe(
      normalizedExact('Silver Birch Premium'),
    );
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizedExact(null)).toBe('');
    expect(normalizedExact(undefined)).toBe('');
  });
});

describe('tokenize', () => {
  it('drops corporate suffix tokens', () => {
    const tokens = tokenize('Hawthorne Cellars, Inc.');
    expect(tokens.has('hawthorne')).toBe(true);
    expect(tokens.has('cellars')).toBe(true);
    expect(tokens.has('inc')).toBe(false);
  });

  it('expands US state names to two-letter codes', () => {
    const tokens = tokenize('Bardstown, Kentucky');
    expect(tokens.has('ky')).toBe(true);
    expect(tokens.has('kentucky')).toBe(false);
  });

  it('drops process tokens (distilled, bottled, brewed, etc.)', () => {
    const tokens = tokenize('Distilled and Bottled by Ridge Creek Distillery');
    expect(tokens.has('distilled')).toBe(false);
    expect(tokens.has('bottled')).toBe(false);
    expect(tokens.has('ridge')).toBe(true);
    expect(tokens.has('creek')).toBe(true);
  });
});

describe('producerMatches', () => {
  it('matches scenario 01 ridge creek across application/label drift', () => {
    expect(
      producerMatches(
        'Ridge Creek Distillery, LLC, Bardstown, KY',
        'Distilled and Bottled by Ridge Creek Distillery LLC · Bardstown, Kentucky',
      ),
    ).toBe(true);
  });

  it('rejects scenario 05 calypso vs tropical spirits (different entity)', () => {
    expect(
      producerMatches(
        'Calypso Sands Distilling, Inc., Miami, FL',
        'Bottled by Tropical Spirits LLC, San Juan, Puerto Rico',
      ),
    ).toBe(false);
  });

  it('matches scenario 02 northern spirits portland oregon', () => {
    expect(
      producerMatches(
        'Northern Spirits Co., Portland, OR',
        'Distilled and bottled by Northern Spirits Co. · Portland, Oregon',
      ),
    ).toBe(true);
  });

  it('matches scenario 03 hawthorne cellars healdsburg', () => {
    expect(
      producerMatches(
        'Hawthorne Cellars, Inc., Healdsburg, CA',
        'Produced and bottled by Hawthorne Cellars, Inc. · Healdsburg, California',
      ),
    ).toBe(true);
  });

  it('matches when the label producer text contains the applicant name plus address', () => {
    expect(
      producerMatches(
        'CHATEAU SAINTE GENEVIEVE',
        'Produced and Bottled by CHATEAU SAINTE GENEVIEVE Bloomsdale, Missouri',
      ),
    ).toBe(true);
  });

  it('matches the approved DBA line used on the label', () => {
    expect(
      producerMatches(
        'Chateau Ste. Genevieve, Bartek Family Winery, LLC\n8921 JACKSON SCHOOL RD\nBloomsdale MO 63627\nCHATEAU SAINTE GENEVIEVE (Used on label)',
        'Produced and Bottled by CHATEAU SAINTE GENEVIEVE Bloomsdale, Missouri American White Wine 2025',
      ),
    ).toBe(true);
  });

  it('matches scenario 04 ironwood brewing asheville', () => {
    expect(
      producerMatches(
        'Ironwood Brewing Co., Asheville, NC',
        'Brewed and canned by Ironwood Brewing Co. · Asheville, North Carolina',
      ),
    ).toBe(true);
  });
});

describe('producerImpliesDomesticOrigin', () => {
  it('detects domestic origin from state names and abbreviations', () => {
    expect(
      producerImpliesDomesticOrigin(
        'Produced and Bottled by Chateau Sainte Genevieve, Bloomsdale, Missouri',
      ),
    ).toBe(true);
    expect(producerImpliesDomesticOrigin('Brewed by Twelve Percent, Westminster, MD')).toBe(true);
  });

  it('does not infer domestic country from importer addresses', () => {
    expect(
      producerImpliesDomesticOrigin('Imported by Boisset Collection, St Helena, CA'),
    ).toBe(false);
  });
});

describe('countryMatches', () => {
  it('matches USA ⇄ United States', () => {
    expect(countryMatches('USA', 'United States')).toBe(true);
    expect(countryMatches('United States', 'U.S.A.')).toBe(true);
    expect(countryMatches('U.S.', 'USA')).toBe(true);
  });

  it('matches domestic USA to Product of USA labels', () => {
    expect(countryMatches('USA', 'Product of USA')).toBe(true);
    expect(countryMatches('Domestic', 'Product of USA')).toBe(false);
  });

  it('rejects different countries', () => {
    expect(countryMatches('USA', 'Mexico')).toBe(false);
    expect(countryMatches('Scotland', 'USA')).toBe(false);
  });
});

describe('wine claim normalization', () => {
  it('treats N/A as no grape varietal or appellation claim', () => {
    expect(normalizeWineVarietalClaim('N/A')).toBeNull();
    expect(normalizeWineVarietalClaim('null')).toBeNull();
    expect(normalizeWineAppellationClaim('N/A')).toBeNull();
  });

  it('does not treat wine blends as grape varietals', () => {
    expect(normalizeWineVarietalClaim('white wine blend')).toBeNull();
    expect(normalizeWineVarietalClaim('Red Blend')).toBeNull();
    expect(normalizeWineVarietalClaim('American White Wine')).toBeNull();
    expect(normalizeWineVarietalClaim('Orange Wine')).toBeNull();
  });

  it('canonicalizes real varietals and appellations', () => {
    expect(normalizeWineVarietalClaim('Cabernet Sauvignon')).toBe(
      'Cabernet Sauvignon',
    );
    expect(normalizeWineVarietalClaim('Pinot Grigio')).toBe('Pinot Gris');
    expect(normalizeWineAppellationClaim('AMERICAN')).toBe('American');
    expect(normalizeWineAppellationClaim('American White Wine')).toBe('American');
  });

  it('preserves unknown appellation strings instead of dropping them', () => {
    expect(normalizeWineAppellationClaim('Some Foreign Region')).toBe(
      'Some Foreign Region',
    );
  });
});

describe('classTypeMatches', () => {
  it('matches normalized exact', () => {
    expect(classTypeMatches('Vodka', 'VODKA')).toBe(true);
    expect(classTypeMatches('Aged Caribbean Rum', 'Aged Caribbean Rum')).toBe(
      true,
    );
  });

  it('rejects different varietals (scenario 03 Cabernet vs Merlot)', () => {
    expect(classTypeMatches('Cabernet Sauvignon', 'Merlot')).toBe(false);
  });

  it('matches bourbon-family aliases', () => {
    expect(
      classTypeMatches(
        'Kentucky Straight Bourbon Whiskey',
        'Bourbon Whiskey',
      ),
    ).toBe(true);
  });

  it('matches IPA ⇄ India Pale Ale (scenario 04)', () => {
    expect(classTypeMatches('India Pale Ale', 'Hop Forge IPA')).toBe(true);
  });

  it('matches Vodka ⇄ Premium Vodka via token containment', () => {
    expect(classTypeMatches('Vodka', 'Premium Vodka')).toBe(true);
  });
});

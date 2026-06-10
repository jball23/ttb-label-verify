import { describe, it, expect } from 'vitest';
import {
  normalizedExact,
  tokenize,
  producerMatches,
  countryMatches,
  classTypeMatches,
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

  it('matches scenario 04 ironwood brewing asheville', () => {
    expect(
      producerMatches(
        'Ironwood Brewing Co., Asheville, NC',
        'Brewed and canned by Ironwood Brewing Co. · Asheville, North Carolina',
      ),
    ).toBe(true);
  });
});

describe('countryMatches', () => {
  it('matches USA ⇄ United States', () => {
    expect(countryMatches('USA', 'United States')).toBe(true);
    expect(countryMatches('United States', 'U.S.A.')).toBe(true);
    expect(countryMatches('U.S.', 'USA')).toBe(true);
  });

  it('rejects different countries', () => {
    expect(countryMatches('USA', 'Mexico')).toBe(false);
    expect(countryMatches('Scotland', 'USA')).toBe(false);
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

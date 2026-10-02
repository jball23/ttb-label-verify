import { describe, expect, it } from 'vitest';
import { compliantReading } from './fake-label-reader';
import { findUsPlace, inferOrigin, UNITED_STATES } from './origin';

function reading(producer: string | null, country: string | null = null) {
  const r = compliantReading();
  r.fields.producer = { value: producer, confidence: 'high' };
  r.fields.countryOfOrigin = { value: country, confidence: 'high' };
  return r;
}

describe('inferOrigin', () => {
  // Silver Birch Premium: "Distilled and bottled by Silver Birch Distilling Co., Portland, Oregon".
  it('infers the United States from a state in the bottler address', () => {
    expect(inferOrigin(reading('Silver Birch Distilling Co., Portland, Oregon'))).toEqual(
      {
        country: UNITED_STATES,
        how: 'address',
        place: 'Portland, Oregon',
        imported: false,
        foreign: false,
      },
    );
  });

  it('reads state codes and ZIP codes', () => {
    expect(
      inferOrigin(reading('Ridge Creek Distillery, LLC, Bardstown, KY 40004')).place,
    ).toBe('Bardstown, KY');
  });

  it('treats US territories as domestic', () => {
    expect(
      inferOrigin(reading('Bottled by Tropical Spirits LLC · San Juan, Puerto Rico')),
    ).toMatchObject({
      country: UNITED_STATES,
      place: 'San Juan, Puerto Rico',
    });
  });

  it('prefers a stated country', () => {
    expect(
      inferOrigin(reading('Bottled by X, Austin, Texas', 'Product of Mexico')),
    ).toMatchObject({
      country: 'Product of Mexico',
      how: 'stated',
    });
  });

  it('does not infer anything from an importer address', () => {
    expect(inferOrigin(reading('Imported by Vino Selections, New York, NY'))).toEqual({
      country: null,
      how: 'unknown',
      place: null,
      imported: true,
      foreign: false,
    });
  });

  // Tenuta San Vincenzo: "ITALIA" with no "Imported by" statement.
  it('recognizes a foreign country written in its own language', () => {
    expect(inferOrigin(reading('Tenuta San Vincenzo, Toscana', 'ITALIA'))).toMatchObject({
      how: 'stated',
      imported: false,
      foreign: true,
    });
    expect(inferOrigin(reading('X', 'Product of U.S.A.')).foreign).toBe(false);
  });

  it('counts a named importer as imported', () => {
    const r = reading('Tenuta San Vincenzo', 'Italy');
    r.fields.importer = {
      value: 'Imported by Vino Co., New York, NY',
      confidence: 'high',
    };
    expect(inferOrigin(r).imported).toBe(true);
  });

  it('says unknown when there is nothing to go on', () => {
    expect(inferOrigin(reading('Old Tom Distillery')).how).toBe('unknown');
    expect(inferOrigin(reading(null)).how).toBe('unknown');
  });
});

describe('findUsPlace', () => {
  it('matches the longest state name, not a shorter one inside it', () => {
    expect(findUsPlace('Charleston, West Virginia')).toBe('Charleston, West Virginia');
  });

  it('does not mistake ordinary words for state codes', () => {
    expect(findUsPlace('Made with love or care in Bordeaux, France')).toBeNull();
  });

  it('leaves out a "Bottled by" segment that is not a town', () => {
    expect(findUsPlace('Bottled by Old Tom, Kentucky')).toBe('Kentucky');
  });
});

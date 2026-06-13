import { describe, expect, it } from 'vitest';
import {
  canonicalWineAppellation,
  canonicalWineVarietal,
  findWineAppellations,
  findWineVarietals,
  isWineTypeOnly,
} from './lexicon';

describe('wine lexicon', () => {
  it('canonicalizes approved grape names and common synonyms', () => {
    expect(canonicalWineVarietal('Cabernet Sauvignon')).toBe(
      'Cabernet Sauvignon',
    );
    expect(canonicalWineVarietal('Pinot Grigio')).toBe('Pinot Gris');
    expect(canonicalWineVarietal('Fume Blanc')).toBe('Sauvignon Blanc');
    expect(canonicalWineVarietal('Garnacha Roja')).toBe('Grenache Gris');
  });

  it('finds varietals inside OCR/VLM snippets', () => {
    expect(canonicalWineVarietal('Contains 78% Cabernet Sauvignon')).toBe(
      'Cabernet Sauvignon',
    );
    expect(
      findWineVarietals('72% Cabernet Sauvignon, 28% Merlot').map(
        (match) => match.canonical,
      ),
    ).toEqual(['Cabernet Sauvignon', 'Merlot']);
  });

  it('does not treat style phrases as grape varietals', () => {
    expect(isWineTypeOnly('white wine blend')).toBe(true);
    expect(canonicalWineVarietal('white wine blend')).toBeNull();
    expect(canonicalWineVarietal('American White Wine')).toBeNull();
  });

  it('canonicalizes common appellations without confusing them for varietals', () => {
    expect(canonicalWineAppellation('AMERICAN')).toBe('American');
    expect(canonicalWineAppellation('American White Wine')).toBe('American');
    expect(canonicalWineAppellation('Napa Valley Cabernet Sauvignon')).toBe(
      'Napa Valley',
    );
    expect(findWineAppellations('Columbia Valley Chardonnay')[0]?.canonical).toBe(
      'Columbia Valley',
    );
  });
});

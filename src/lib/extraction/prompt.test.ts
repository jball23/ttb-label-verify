import { describe, it, expect } from 'vitest';
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_INTRO } from './prompt';

describe('PROMPT_VERSION', () => {
  it('is the v7 string for the extended Item-set prompt', () => {
    expect(PROMPT_VERSION).toBe('2026-06-11.v7');
  });

  it('differs from earlier revisions', () => {
    expect(PROMPT_VERSION).not.toBe('2026-06-10.v3');
    expect(PROMPT_VERSION).not.toBe('2026-06-10.v4');
    expect(PROMPT_VERSION).not.toBe('2026-06-10.v5');
    expect(PROMPT_VERSION).not.toBe('2026-06-11.v6');
  });
});

describe('SYSTEM_PROMPT', () => {
  it('frames the task as both application + label extraction', () => {
    expect(SYSTEM_PROMPT).toMatch(/application|TTB Form 5100\.31/i);
    expect(SYSTEM_PROMPT).toMatch(/affixed[- ]?label/i);
  });

  it('notes that input may be one or more page images', () => {
    expect(SYSTEM_PROMPT).toMatch(/one or more|multiple page|several page/i);
  });

  it('mentions front and back labels for multi-page real exports', () => {
    expect(SYSTEM_PROMPT).toMatch(/front/i);
    expect(SYSTEM_PROMPT).toMatch(/back/i);
  });

  it('mentions provenance bounding boxes', () => {
    expect(SYSTEM_PROMPT).toMatch(/provenance/i);
    expect(SYSTEM_PROMPT).toMatch(/bounding box(?:es)?/i);
  });

  it('enumerates application paths', () => {
    expect(SYSTEM_PROMPT).toContain('application.brandName');
    expect(SYSTEM_PROMPT).toContain('application.applicant.name');
    expect(SYSTEM_PROMPT).toContain('application.applicationDate');
  });

  it('enumerates label paths', () => {
    expect(SYSTEM_PROMPT).toContain('label.governmentWarning');
    expect(SYSTEM_PROMPT).toContain('label.producer');
    expect(SYSTEM_PROMPT).toContain('label.wineVarietal');
  });

  it('specifies normalized 0..1 top-left coordinate convention', () => {
    expect(SYSTEM_PROMPT).toMatch(/normalized/i);
    expect(SYSTEM_PROMPT).toMatch(/top[- ]?left/i);
    expect(SYSTEM_PROMPT).toMatch(/0\.\.1|0..1/);
  });

  it('enumerates the three confidence tiers', () => {
    expect(SYSTEM_PROMPT).toMatch(/"high"/);
    expect(SYSTEM_PROMPT).toMatch(/"medium"/);
    expect(SYSTEM_PROMPT).toMatch(/"low"/);
  });

  it('preserves the verbatim government warning rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/GOVERNMENT WARNING:/);
    expect(SYSTEM_PROMPT).toMatch(/verbatim/i);
  });

  it('instructs wine fields to be null for non-wine labels', () => {
    expect(SYSTEM_PROMPT).toMatch(/null[\s\S]{0,80}wineVarietal|wineVarietal[\s\S]{0,80}null/i);
  });
});

describe('USER_PROMPT_INTRO', () => {
  it('reminds about normalized coordinates and the government warning prefix', () => {
    expect(USER_PROMPT_INTRO).toMatch(/normalized/i);
    expect(USER_PROMPT_INTRO).toMatch(/GOVERNMENT WARNING:/);
  });
});

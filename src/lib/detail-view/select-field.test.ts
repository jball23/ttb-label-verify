import { describe, it, expect } from 'vitest';
import {
  availableTabs,
  derivePageKinds,
  pageForTab,
  selectField,
} from './select-field';
import { type FieldBboxes, type WordRect } from '../extraction/types';

function rect(x0 = 10, y0 = 20, x1 = 50, y1 = 35): WordRect['bbox'] {
  return { x0, y0, x1, y1 };
}
const W: WordRect = { text: 'TOKEN', confidence: 90, bbox: rect() };

describe('selectField', () => {
  it('tesseract bbox: returns tab + page + words from the bbox', () => {
    const bboxes: FieldBboxes = {
      'label.brandName': {
        page: 3,
        source: 'tesseract',
        words: [W],
        meanConfidence: 92,
      },
    };
    const sel = selectField('label.brandName', bboxes);
    expect(sel.tab).toBe('front');
    expect(sel.page).toBe(3);
    expect(sel.words).toEqual([W]);
    expect(sel.isVlmFallback).toBe(false);
  });

  it('VLM fallback: returns no words and flags isVlmFallback', () => {
    const bboxes: FieldBboxes = {
      'label.brandName': {
        page: 1,
        source: 'vlm',
        words: [],
        meanConfidence: null,
      },
    };
    const sel = selectField('label.brandName', bboxes);
    expect(sel.tab).toBe('front');
    expect(sel.words).toBeNull();
    expect(sel.isVlmFallback).toBe(true);
  });

  it('side-agnostic: GW with no document info defaults to front (not hardcoded back)', () => {
    // GW can live on front, back, neck, or strip — no hardcoded back bias on
    // the routing path. With no pages/bboxes to consult, pickTab defaults to front.
    const sel = selectField('label.governmentWarning', {});
    expect(sel.tab).toBe('front');
    expect(sel.words).toBeNull();
    expect(sel.isVlmFallback).toBe(false);
  });

  it('side-agnostic: GW routes to back when only a back-label page exists', () => {
    const sel = selectField(
      'label.governmentWarning',
      {},
      [{ pageNumber: 4, kind: 'label-back' }],
    );
    expect(sel.tab).toBe('back');
  });

  it('side-agnostic: GW prefers front when both label pages exist', () => {
    const sel = selectField(
      'label.governmentWarning',
      {},
      [
        { pageNumber: 3, kind: 'label-front' },
        { pageNumber: 4, kind: 'label-back' },
      ],
    );
    expect(sel.tab).toBe('front');
  });

  it('label.brandName keeps soft front bias even with no front page tagged', () => {
    const sel = selectField(
      'label.brandName',
      {},
      [{ pageNumber: 4, kind: 'label-back' }],
    );
    // brandName is universally a front-label wordmark — the routing reflects
    // that even when only back-label pages have been tagged.
    expect(sel.tab).toBe('front');
  });

  it('application.* maps to form tab', () => {
    const sel = selectField('application.brandName', {});
    expect(sel.tab).toBe('form');
  });

  it('derivePageKinds: form > back > front precedence on conflicting pages', () => {
    // Page 2 has both an application.* (form) and a label.brandName (front)
    // bbox — `form` should win because the form is more specific evidence
    // of the page's identity.
    const bboxes: FieldBboxes = {
      'application.brandName': {
        page: 2,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      'label.brandName': {
        page: 2,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      'label.governmentWarning': {
        page: 4,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
    };
    const kinds = derivePageKinds(bboxes);
    expect(kinds.get(2)).toBe('form');
    expect(kinds.get(4)).toBe('back');
  });

  it('derivePageKinds: renderer front/back tags are not rewritten by field heuristics', () => {
    const bboxes: FieldBboxes = {
      'label.governmentWarning': {
        page: 2,
        source: 'tesseract',
        words: [W],
        meanConfidence: 92,
      },
    };
    const pages = [
      { pageNumber: 1, kind: 'form' },
      { pageNumber: 2, kind: 'label-front' },
    ];

    const kinds = derivePageKinds(bboxes, pages);
    expect(kinds.get(2)).toBe('front');
    expect(availableTabs(bboxes, pages).has('back')).toBe(false);

    const sel = selectField('label.governmentWarning', bboxes, pages);
    expect(sel.tab).toBe('front');
    expect(sel.page).toBe(2);
  });

  it('availableTabs: surfaces only tabs with backing pages', () => {
    const bboxes: FieldBboxes = {
      'application.brandName': {
        page: 1,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      'label.brandName': {
        page: 3,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      // No back-label bbox at all
    };
    const tabs = availableTabs(bboxes);
    expect(tabs.has('form')).toBe(true);
    expect(tabs.has('front')).toBe(true);
    expect(tabs.has('back')).toBe(false);
  });

  it('pageForTab: returns lowest-numbered page for that kind', () => {
    const bboxes: FieldBboxes = {
      'label.brandName': {
        page: 5,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      'label.abv': {
        page: 3,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
    };
    expect(pageForTab('front', bboxes)).toBe(3);
    expect(pageForTab('back', bboxes)).toBeNull();
  });

  it('selectField uses bbox.page kind over path heuristic when available', () => {
    // Stress test: a label.brandName landed on a page tagged as `form` by
    // other bboxes (synthetic / weird-layout case). Selection follows the
    // page's actual derived kind, not the path-based default.
    const bboxes: FieldBboxes = {
      'application.serialNumber': {
        page: 2,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
      'label.brandName': {
        page: 2,
        source: 'tesseract',
        words: [W],
        meanConfidence: 90,
      },
    };
    const sel = selectField('label.brandName', bboxes);
    expect(sel.tab).toBe('form');
    expect(sel.page).toBe(2);
  });
});

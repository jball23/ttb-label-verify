import { describe, it, expect } from 'vitest';
import { phaseReducer, INITIAL_STATE } from './phase-reducer';
import { type ResultLine } from '../results/result-types';

function makePdf(name = 'application.pdf'): File {
  return new File([new Uint8Array(8)], name, { type: 'application/pdf' });
}

function okResult(filename = 'application.pdf'): ResultLine {
  return {
    status: 'ok',
    index: 0,
    filename,
    durationMs: 100,
    report: {
      overallStatus: 'compliant',
      crossCheck: { overallStatus: 'match', fields: {} },
      fields: {},
      provenance: {},
      extractedForm: {
        plantRegistryNumber: null,
        source: null,
        serialNumber: null,
        productType: null,
        brandName: null,
        fancifulName: null,
        applicant: { name: null, addressLine1: null, city: null, state: null, postalCode: null },
        grapeVarietals: null,
        wineAppellation: null,
        phone: null,
        email: null,
        applicationType: null,
        applicationDate: null,
        applicantSignatureName: null,
      },
      extractedLabel: {
        brandName: null,
        abv: null,
        governmentWarning: { text: null, appearsAllCaps: null, appearsBold: null },
        netContents: null,
        classType: null,
        producer: null,
        countryOfOrigin: null,
        wineVarietal: null,
        wineAppellation: null,
        extractionConfidence: 'high',
      },
    },
  };
}

function errResult(filename = 'application.pdf'): ResultLine {
  return {
    status: 'error',
    index: 0,
    filename,
    durationMs: 100,
    errorMessage: 'render failed',
  };
}

describe('phaseReducer', () => {
  it('initial state has no cards', () => {
    expect(INITIAL_STATE).toEqual({ phase: 'empty', cards: [] });
  });

  it('FILES_ADDED stages new cards', () => {
    const next = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf'), makePdf('b.pdf')],
    });
    expect(next.phase).toBe('staged');
    expect(next.cards).toHaveLength(2);
    expect(next.cards.every((c) => c.status === 'pending')).toBe(true);
    expect(next.cards[0]!.id).not.toBe(next.cards[1]!.id);
  });

  it('FILES_ADDED appends to existing cards', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const b = phaseReducer(a, { type: 'FILES_ADDED', files: [makePdf('b.pdf')] });
    expect(b.cards).toHaveLength(2);
  });

  it('CARD_REMOVED takes a single card out of the list', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf'), makePdf('b.pdf')],
    });
    const removed = phaseReducer(a, { type: 'CARD_REMOVED', id: a.cards[0]!.id });
    expect(removed.cards).toHaveLength(1);
    expect(removed.cards[0]!.file.name).toBe('b.pdf');
  });

  it('CARD_REMOVED of the last card resets to initial', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const removed = phaseReducer(a, { type: 'CARD_REMOVED', id: a.cards[0]!.id });
    expect(removed).toEqual(INITIAL_STATE);
  });

  it('CARD_VERIFY_STARTED sets that card to processing', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf'), makePdf('b.pdf')],
    });
    const next = phaseReducer(a, {
      type: 'CARD_VERIFY_STARTED',
      id: a.cards[1]!.id,
    });
    expect(next.cards[0]!.status).toBe('pending');
    expect(next.cards[1]!.status).toBe('processing');
  });

  it('CARD_RESULT_RECEIVED with ok result marks done + stores it', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const next = phaseReducer(a, {
      type: 'CARD_RESULT_RECEIVED',
      id: a.cards[0]!.id,
      result: okResult(),
    });
    expect(next.cards[0]!.status).toBe('done');
    expect(next.cards[0]!.result).not.toBeNull();
  });

  it('CARD_RESULT_RECEIVED with error result marks card as error', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const next = phaseReducer(a, {
      type: 'CARD_RESULT_RECEIVED',
      id: a.cards[0]!.id,
      result: errResult(),
    });
    expect(next.cards[0]!.status).toBe('error');
    expect(next.cards[0]!.errorMessage).toMatch(/render failed/);
  });

  it('VERIFY_STARTED moves phase to processing', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const next = phaseReducer(a, { type: 'VERIFY_STARTED' });
    expect(next.phase).toBe('processing');
  });

  it('BATCH_COMPLETE moves processing -> done', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf')],
    });
    const p = phaseReducer(a, { type: 'VERIFY_STARTED' });
    const d = phaseReducer(p, { type: 'BATCH_COMPLETE' });
    expect(d.phase).toBe('done');
  });

  it('START_OVER from any phase returns to initial state', () => {
    const a = phaseReducer(INITIAL_STATE, {
      type: 'FILES_ADDED',
      files: [makePdf('a.pdf'), makePdf('b.pdf')],
    });
    const p = phaseReducer(a, { type: 'VERIFY_STARTED' });
    const d = phaseReducer(p, { type: 'START_OVER' });
    expect(d).toEqual(INITIAL_STATE);
  });
});

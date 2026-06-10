import { describe, it, expect } from 'vitest';
import { phaseReducer, INITIAL_STATE, type AppState } from './phase-reducer';
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
    },
  };
}

describe('phaseReducer', () => {
  it('initial state is empty/no-file/no-result', () => {
    expect(INITIAL_STATE).toEqual({
      phase: 'empty',
      pdfFile: null,
      result: null,
      errorMessage: null,
    });
  });

  it('PDF_STAGED from empty moves to staged with the file', () => {
    const f = makePdf();
    const next = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    expect(next.phase).toBe('staged');
    expect(next.pdfFile).toBe(f);
  });

  it('PDF_STAGED replaces any previously staged file', () => {
    const f1 = makePdf('a.pdf');
    const f2 = makePdf('b.pdf');
    const after = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f1 });
    const next = phaseReducer(after, { type: 'PDF_STAGED', file: f2 });
    expect(next.pdfFile).toBe(f2);
  });

  it('PDF_CLEARED returns to initial state', () => {
    const f = makePdf();
    const after = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    expect(phaseReducer(after, { type: 'PDF_CLEARED' })).toEqual(INITIAL_STATE);
  });

  it('SCENARIO_LOADED_PDF stages a scenario PDF from empty', () => {
    const f = makePdf('scenario-01.pdf');
    const next = phaseReducer(INITIAL_STATE, {
      type: 'SCENARIO_LOADED_PDF',
      file: f,
    });
    expect(next.phase).toBe('staged');
    expect(next.pdfFile).toBe(f);
  });

  it('SCENARIO_LOADED_PDF from verified clears the prior result', () => {
    const f1 = makePdf('a.pdf');
    const staged = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f1 });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const withResult = phaseReducer(processing, {
      type: 'RESULT_RECEIVED',
      result: okResult(),
    });
    const done = phaseReducer(withResult, { type: 'STREAM_CLOSED' });
    expect(done.phase).toBe('done');
    expect(done.result).not.toBeNull();
    const reloaded = phaseReducer(done, {
      type: 'SCENARIO_LOADED_PDF',
      file: makePdf('b.pdf'),
    });
    expect(reloaded.phase).toBe('staged');
    expect(reloaded.result).toBeNull();
  });

  it('VERIFY_STARTED moves staged → processing and clears prior result', () => {
    const f = makePdf();
    const staged = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    const next = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    expect(next.phase).toBe('processing');
    expect(next.result).toBeNull();
  });

  it('VERIFY_STARTED while empty leaves state unchanged', () => {
    const next = phaseReducer(INITIAL_STATE, { type: 'VERIFY_STARTED' });
    expect(next).toBe(INITIAL_STATE);
  });

  it('RESULT_RECEIVED stores the result while processing', () => {
    const f = makePdf();
    const staged = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const r = okResult();
    const next = phaseReducer(processing, { type: 'RESULT_RECEIVED', result: r });
    expect(next.result).toBe(r);
  });

  it('RESULT_RECEIVED outside processing leaves state unchanged', () => {
    const next = phaseReducer(INITIAL_STATE, {
      type: 'RESULT_RECEIVED',
      result: okResult(),
    });
    expect(next).toBe(INITIAL_STATE);
  });

  it('STREAM_CLOSED moves processing → done', () => {
    const f = makePdf();
    const staged = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const done = phaseReducer(processing, { type: 'STREAM_CLOSED' });
    expect(done.phase).toBe('done');
  });

  it('VERIFY_FAILED captures the message and moves to error from any phase', () => {
    const f = makePdf();
    const staged = phaseReducer(INITIAL_STATE, { type: 'PDF_STAGED', file: f });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const next = phaseReducer(processing, {
      type: 'VERIFY_FAILED',
      message: 'render exploded',
    });
    expect(next.phase).toBe('error');
    expect(next.errorMessage).toBe('render exploded');
  });

  it('START_OVER from any phase returns to initial state', () => {
    const state: AppState = {
      phase: 'done',
      pdfFile: makePdf(),
      result: okResult(),
      errorMessage: null,
    };
    expect(phaseReducer(state, { type: 'START_OVER' })).toEqual(INITIAL_STATE);
  });
});

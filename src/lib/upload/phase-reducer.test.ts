import { describe, it, expect } from 'vitest';
import { phaseReducer, INITIAL_STATE, type AppState } from './phase-reducer';
import { type ResultLine } from '../results/result-types';

function makeFile(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'image/jpeg' });
}

function okResult(filename: string, index = 0): ResultLine {
  return {
    status: 'ok',
    index,
    filename,
    durationMs: 100,
    report: { overallStatus: 'compliant', crossCheck: { overallStatus: 'match', fields: {} }, fields: {} },
  };
}

describe('phaseReducer', () => {
  it('initial state is empty/no-files/no-results', () => {
    expect(INITIAL_STATE).toEqual({
      phase: 'empty',
      files: [],
      application: null,
      results: [],
      totalExpected: 0,
    });
  });

  it('SCENARIO_LOADED replaces files + application and stages', () => {
    const app = { scenarioId: 'test-01' } as unknown as NonNullable<
      AppState['application']
    >;
    const file = makeFile('label.jpg');
    const next = phaseReducer(INITIAL_STATE, {
      type: 'SCENARIO_LOADED',
      application: app,
      file,
    });
    expect(next.phase).toBe('staged');
    expect(next.files).toEqual([file]);
    expect(next.application).toBe(app);
  });

  it('SCENARIO_LOADED replaces any previously staged files', () => {
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [makeFile('old.jpg')],
    });
    const app = { scenarioId: 'test-02' } as unknown as NonNullable<
      AppState['application']
    >;
    const newFile = makeFile('new.jpg');
    const next = phaseReducer(staged, {
      type: 'SCENARIO_LOADED',
      application: app,
      file: newFile,
    });
    expect(next.files).toEqual([newFile]);
    expect(next.application).toBe(app);
  });

  it('START_OVER clears application back to null', () => {
    const app = { scenarioId: 'x' } as unknown as NonNullable<
      AppState['application']
    >;
    const loaded = phaseReducer(INITIAL_STATE, {
      type: 'SCENARIO_LOADED',
      application: app,
      file: makeFile('a.jpg'),
    });
    const cleared = phaseReducer(loaded, { type: 'START_OVER' });
    expect(cleared.application).toBeNull();
  });

  it('FILES_STAGED from empty moves to staged with the files', () => {
    const next = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [makeFile('a.jpg'), makeFile('b.jpg')],
    });
    expect(next.phase).toBe('staged');
    expect(next.files).toHaveLength(2);
  });

  it('FILES_STAGED from staged appends files', () => {
    const f1 = makeFile('a.jpg');
    const f2 = makeFile('b.jpg');
    const after1 = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [f1],
    });
    const after2 = phaseReducer(after1, { type: 'FILES_STAGED', files: [f2] });
    expect(after2.files).toEqual([f1, f2]);
  });

  it('FILE_REMOVED removes a single file but stays staged', () => {
    const f1 = makeFile('a.jpg');
    const f2 = makeFile('b.jpg');
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [f1, f2],
    });
    const next = phaseReducer(staged, { type: 'FILE_REMOVED', file: f1 });
    expect(next.phase).toBe('staged');
    expect(next.files).toEqual([f2]);
  });

  it('FILE_REMOVED of the last file returns to empty', () => {
    const f = makeFile('a.jpg');
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [f],
    });
    const next = phaseReducer(staged, { type: 'FILE_REMOVED', file: f });
    expect(next.phase).toBe('empty');
    expect(next.files).toEqual([]);
  });

  it('VERIFY_STARTED moves to processing with totalExpected set', () => {
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [makeFile('a.jpg'), makeFile('b.jpg')],
    });
    const next = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    expect(next.phase).toBe('processing');
    expect(next.totalExpected).toBe(2);
    expect(next.results).toEqual([]);
  });

  it('RESULT_RECEIVED appends in arrival order', () => {
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [makeFile('a.jpg'), makeFile('b.jpg')],
    });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const r1 = okResult('b.jpg', 1);
    const r2 = okResult('a.jpg', 0);
    const after1 = phaseReducer(processing, {
      type: 'RESULT_RECEIVED',
      result: r1,
    });
    const after2 = phaseReducer(after1, { type: 'RESULT_RECEIVED', result: r2 });
    expect(after2.results).toEqual([r1, r2]);
  });

  it('STREAM_CLOSED moves processing to done', () => {
    const staged = phaseReducer(INITIAL_STATE, {
      type: 'FILES_STAGED',
      files: [makeFile('a.jpg')],
    });
    const processing = phaseReducer(staged, { type: 'VERIFY_STARTED' });
    const done = phaseReducer(processing, { type: 'STREAM_CLOSED' });
    expect(done.phase).toBe('done');
  });

  it('START_OVER from any phase returns to initial state', () => {
    const state: AppState = {
      phase: 'done',
      files: [makeFile('a.jpg')],
      application: null,
      results: [okResult('a.jpg')],
      totalExpected: 1,
    };
    expect(phaseReducer(state, { type: 'START_OVER' })).toEqual(INITIAL_STATE);
  });

  it('invalid transition (RESULT_RECEIVED while empty) leaves state unchanged', () => {
    const next = phaseReducer(INITIAL_STATE, {
      type: 'RESULT_RECEIVED',
      result: okResult('a.jpg'),
    });
    expect(next).toBe(INITIAL_STATE);
  });

  it('invalid transition (VERIFY_STARTED while empty) leaves state unchanged', () => {
    const next = phaseReducer(INITIAL_STATE, { type: 'VERIFY_STARTED' });
    expect(next).toBe(INITIAL_STATE);
  });
});

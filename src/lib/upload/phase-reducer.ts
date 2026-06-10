import { type ResultLine } from '../results/result-types';

/**
 * Phase state machine for the verify page.
 *
 * The PDF-only flow has a single file and a single result, so the model
 * collapses from `application + files[]` to `pdfFile + result`. Selection
 * state (which extracted field is currently highlighted) is intentionally
 * NOT in the reducer — it's UI state owned by the verifier pane.
 */

export type Phase = 'empty' | 'staged' | 'processing' | 'done' | 'error';

export interface AppState {
  phase: Phase;
  pdfFile: File | null;
  result: ResultLine | null;
  errorMessage: string | null;
}

export const INITIAL_STATE: AppState = {
  phase: 'empty',
  pdfFile: null,
  result: null,
  errorMessage: null,
};

export type Action =
  | { type: 'PDF_STAGED'; file: File }
  | { type: 'PDF_CLEARED' }
  | { type: 'SCENARIO_LOADED_PDF'; file: File }
  | { type: 'VERIFY_STARTED' }
  | { type: 'RESULT_RECEIVED'; result: ResultLine }
  | { type: 'STREAM_CLOSED' }
  | { type: 'VERIFY_FAILED'; message: string }
  | { type: 'START_OVER' };

export function phaseReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'PDF_STAGED':
      return {
        ...state,
        phase: 'staged',
        pdfFile: action.file,
        result: null,
        errorMessage: null,
      };
    case 'PDF_CLEARED':
      return { ...INITIAL_STATE };
    case 'SCENARIO_LOADED_PDF':
      // Loading a scenario clears any prior result and replaces the staged PDF.
      return {
        ...state,
        phase: 'staged',
        pdfFile: action.file,
        result: null,
        errorMessage: null,
      };
    case 'VERIFY_STARTED': {
      if (state.phase !== 'staged') return state;
      return { ...state, phase: 'processing', result: null, errorMessage: null };
    }
    case 'RESULT_RECEIVED': {
      if (state.phase !== 'processing') return state;
      return { ...state, result: action.result };
    }
    case 'STREAM_CLOSED': {
      if (state.phase !== 'processing') return state;
      return { ...state, phase: 'done' };
    }
    case 'VERIFY_FAILED':
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
      };
    case 'START_OVER':
      return { ...INITIAL_STATE };
    default:
      return assertNever(action);
  }
}

function assertNever(_: never): AppState {
  return INITIAL_STATE;
}

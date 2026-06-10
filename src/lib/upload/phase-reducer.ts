import { type ResultLine } from '../results/result-types';
import { type Application } from '../application/types';

/**
 * The phase state machine for the upload page.
 *
 * Lifted out of the component so it's a pure reducer — testable as a function,
 * not as a rendered component. The component just dispatches and renders state.
 */

export type Phase = 'empty' | 'staged' | 'processing' | 'done';

export interface AppState {
  phase: Phase;
  files: File[];
  application: Application | null;
  results: ResultLine[];
  totalExpected: number;
}

export const INITIAL_STATE: AppState = {
  phase: 'empty',
  files: [],
  application: null,
  results: [],
  totalExpected: 0,
};

export type Action =
  | { type: 'FILES_STAGED'; files: File[] }
  | { type: 'FILE_REMOVED'; file: File }
  | { type: 'SCENARIO_LOADED'; application: Application; file: File }
  | { type: 'VERIFY_STARTED' }
  | { type: 'RESULT_RECEIVED'; result: ResultLine }
  | { type: 'STREAM_CLOSED' }
  | { type: 'START_OVER' };

export function phaseReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'FILES_STAGED': {
      if (state.phase !== 'empty' && state.phase !== 'staged') return state;
      const combined = [...state.files, ...action.files];
      if (combined.length === 0) return state;
      return { ...state, phase: 'staged', files: combined };
    }
    case 'FILE_REMOVED': {
      if (state.phase !== 'staged') return state;
      const remaining = state.files.filter((f) => f !== action.file);
      if (remaining.length === 0) {
        return { ...INITIAL_STATE };
      }
      return { ...state, files: remaining };
    }
    case 'SCENARIO_LOADED': {
      // Loading a scenario replaces any manually-staged files and the
      // previously-loaded application — a scenario is a complete pair.
      return {
        ...state,
        phase: 'staged',
        files: [action.file],
        application: action.application,
      };
    }
    case 'VERIFY_STARTED': {
      if (state.phase !== 'staged') return state;
      return {
        ...state,
        phase: 'processing',
        results: [],
        totalExpected: state.files.length,
      };
    }
    case 'RESULT_RECEIVED': {
      if (state.phase !== 'processing') return state;
      return { ...state, results: [...state.results, action.result] };
    }
    case 'STREAM_CLOSED': {
      if (state.phase !== 'processing') return state;
      return { ...state, phase: 'done' };
    }
    case 'START_OVER':
      return { ...INITIAL_STATE };
    default:
      return assertNever(action);
  }
}

function assertNever(_: never): AppState {
  // Reached only if a new Action variant is added without a switch case.
  return INITIAL_STATE;
}

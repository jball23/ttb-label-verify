import { type ResultLine } from '../results/result-types';

/**
 * Batch-aware state machine for the verify page.
 *
 * Each uploaded PDF becomes a card with its own per-file status. Cards run
 * concurrently inside the orchestrator (home-client) up to a fixed
 * concurrency cap. Expanding a card shows its full verifier; collapsed cards
 * show just the filename + status + verdict.
 */

export type Phase = 'empty' | 'staged' | 'processing' | 'done';

export type CardStatus = 'pending' | 'processing' | 'done' | 'error';

export interface UploadCard {
  id: string;
  file: File;
  status: CardStatus;
  result: ResultLine | null;
  errorMessage: string | null;
}

export interface AppState {
  phase: Phase;
  cards: UploadCard[];
}

export const INITIAL_STATE: AppState = {
  phase: 'empty',
  cards: [],
};

export type Action =
  | { type: 'FILES_ADDED'; files: File[] }
  | { type: 'CARD_REMOVED'; id: string }
  | { type: 'VERIFY_STARTED' }
  | { type: 'CARD_VERIFY_STARTED'; id: string }
  | { type: 'CARD_RESULT_RECEIVED'; id: string; result: ResultLine }
  | { type: 'CARD_VERIFY_FAILED'; id: string; message: string }
  | { type: 'BATCH_COMPLETE' }
  | { type: 'START_OVER' };

function makeCardId(): string {
  return `card_${Math.floor(Math.random() * 1e9).toString(36)}_${Date.now().toString(36)}`;
}

function makeCard(file: File): UploadCard {
  return {
    id: makeCardId(),
    file,
    status: 'pending',
    result: null,
    errorMessage: null,
  };
}

function mapCard(
  state: AppState,
  id: string,
  update: (card: UploadCard) => UploadCard,
): AppState {
  return {
    ...state,
    cards: state.cards.map((c) => (c.id === id ? update(c) : c)),
  };
}

export function phaseReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'FILES_ADDED': {
      if (action.files.length === 0) return state;
      const newCards = action.files.map(makeCard);
      return {
        ...state,
        phase: 'staged',
        cards: [...state.cards, ...newCards],
      };
    }
    case 'CARD_REMOVED': {
      const remaining = state.cards.filter((c) => c.id !== action.id);
      if (remaining.length === 0) return INITIAL_STATE;
      return { ...state, cards: remaining };
    }
    case 'VERIFY_STARTED': {
      if (state.cards.length === 0) return state;
      return { ...state, phase: 'processing' };
    }
    case 'CARD_VERIFY_STARTED':
      return mapCard(state, action.id, (c) => ({
        ...c,
        status: 'processing',
        result: null,
        errorMessage: null,
      }));
    case 'CARD_RESULT_RECEIVED': {
      // A card's status follows the result line's own status — error lines
      // surface as 'error' on the card.
      const result = action.result;
      const cardStatus: CardStatus = result.status === 'ok' ? 'done' : 'error';
      const errorMessage =
        result.status === 'error' ? result.errorMessage : null;
      return mapCard(state, action.id, (c) => ({
        ...c,
        status: cardStatus,
        result,
        errorMessage,
      }));
    }
    case 'CARD_VERIFY_FAILED':
      return mapCard(state, action.id, (c) => ({
        ...c,
        status: 'error',
        errorMessage: action.message,
      }));
    case 'BATCH_COMPLETE':
      return { ...state, phase: 'done' };
    case 'START_OVER':
      return INITIAL_STATE;
    default:
      return assertNever(action);
  }
}

function assertNever(_: never): AppState {
  return INITIAL_STATE;
}

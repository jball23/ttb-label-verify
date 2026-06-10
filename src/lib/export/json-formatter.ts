import { type ResultLine } from '../results/result-types';

export function formatJSON(results: ResultLine[]): string {
  return JSON.stringify({ results }, null, 2);
}

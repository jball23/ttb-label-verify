import { type ExtractedFields } from '../../src/lib/extraction/types';
import compliantBourbon from './compliant-bourbon.json';
import missingWarning from './missing-warning.json';
import wrongAbvFormat from './wrong-abv-format.json';
import partialExtraction from './partial-extraction.json';
import edgeCaseForeignImport from './edge-case-foreign-import.json';

export interface EvalCase {
  id: string;
  imagePath: string;
  expected: ExtractedFields;
  notes: string;
}

const RAW_CASES: EvalCase[] = [
  compliantBourbon as EvalCase,
  missingWarning as EvalCase,
  wrongAbvFormat as EvalCase,
  partialExtraction as EvalCase,
  edgeCaseForeignImport as EvalCase,
];

export function getDataset(): EvalCase[] {
  return RAW_CASES;
}

import { tryGetDb } from '@/db/client';
import { DrizzleLabelRepository } from '@/db/drizzle-label-repository';
import { type LabelRepository } from './label-record';
import { type LabelServiceDeps } from './label-service';
import { MemoryLabelRepository } from './memory-label-repository';
import { getLabelReader } from './reader-factory';

let repo: LabelRepository | null = null;

/** Composition root: the only place that chooses concrete implementations. */
export function getLabelRepository(): LabelRepository {
  if (repo) return repo;
  const db = tryGetDb();
  repo = db ? new DrizzleLabelRepository(db) : new MemoryLabelRepository();
  return repo;
}

export function getLabelServiceDeps(): LabelServiceDeps {
  return { reader: getLabelReader(), repo: getLabelRepository() };
}

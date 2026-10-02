import { tryGetDb } from '@/db/client';
import { DrizzleLabelRepository } from '@/db/drizzle-label-repository';
import { type LabelRepository } from './label-record';
import { type LabelServiceDeps } from './label-service';
import { MemoryLabelRepository } from './memory-label-repository';
import { getLabelReader } from './reader-factory';

/**
 * Held on globalThis, not in a module variable: Next.js can load this module
 * more than once in one server process (route handlers and pages are bundled
 * separately, and dev reloads modules), and the in-memory store must be the
 * same one for all of them or a label saved by the API is missing on its page.
 */
const holder = globalThis as typeof globalThis & { __labelRepository?: LabelRepository };

/** Composition root: the only place that chooses concrete implementations. */
export function getLabelRepository(): LabelRepository {
  if (holder.__labelRepository) return holder.__labelRepository;
  const db = tryGetDb();
  holder.__labelRepository = db
    ? new DrizzleLabelRepository(db)
    : new MemoryLabelRepository();
  return holder.__labelRepository;
}

export function getLabelServiceDeps(): LabelServiceDeps {
  return { reader: getLabelReader(), repo: getLabelRepository() };
}

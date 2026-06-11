import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: Database | null = null;

/**
 * Lazily build the Drizzle client so importing this module doesn't crash
 * the app at startup when DATABASE_URL is absent (Vercel preview without
 * a connected branch, local dev when the DB is intentionally offline).
 *
 * Throws on first call when DATABASE_URL is missing — callers that want
 * graceful degradation should use `tryGetDb()` instead.
 */
export function getDb(): Database {
  if (cached) return cached;
  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in .env.local (Neon connection string) before using the database.',
    );
  }
  cached = drizzle(neon(env.DATABASE_URL), { schema, casing: 'snake_case' });
  return cached;
}

export function tryGetDb(): Database | null {
  const env = getEnv();
  if (!env.DATABASE_URL) return null;
  return getDb();
}

export function resetDbForTesting(): void {
  cached = null;
}

export { schema };

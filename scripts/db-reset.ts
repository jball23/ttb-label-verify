/**
 * Empties `labels` and `label_decisions`: every uploaded label, its reading,
 * corrections and decision history.
 *
 * Usage:
 *   npm run db:reset           # prompts for confirmation
 *   npm run db:reset -- --yes  # skips the prompt
 *
 * Requires DATABASE_URL in .env.local. Does NOT drop the tables — schema
 * stays intact. To rebuild schema from scratch, apply the migrations in
 * drizzle/ instead.
 */

import { config } from 'dotenv';
import readline from 'node:readline';
import { sql } from 'drizzle-orm';

config({ path: '.env.local' });

async function confirm(host: string): Promise<boolean> {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  This will DELETE every label and decision on ${host}.\n   Truncate? [y/N] `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env.local and try again.');
    process.exit(1);
  }

  if (!(await confirm(new URL(url).host))) {
    console.log('Cancelled.');
    return;
  }

  // Dynamic import so we don't crash on missing env at module load.
  const { getDb } = await import('../src/db/client');
  const db = getDb();

  console.log('Truncating label_decisions, labels…');
  // label_decisions references labels, so both go in one statement.
  await db.execute(sql`TRUNCATE TABLE label_decisions, labels`);
  const { rows } = await db.execute<{ labels: number; decisions: number }>(
    sql`SELECT (SELECT count(*) FROM labels)::int AS labels,
               (SELECT count(*) FROM label_decisions)::int AS decisions`,
  );
  const left = rows[0]!;
  if (left.labels !== 0 || left.decisions !== 0) {
    throw new Error(`Rows remain: ${left.labels} labels, ${left.decisions} decisions.`);
  }
  console.log('✓ Done. labels: 0, label_decisions: 0.');
}

main().catch((e) => {
  console.error('Reset failed:', e);
  process.exit(1);
});

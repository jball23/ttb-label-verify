/**
 * Truncates `applications` and `reviews` (cascade), restarting identity.
 *
 * Usage:
 *   npm run db:reset           # prompts for confirmation
 *   npm run db:reset -- --yes  # skips the prompt
 *
 * Requires DATABASE_URL in .env.local. Does NOT drop the tables — schema
 * stays intact. To rebuild schema from scratch, run `db:push` after this.
 */

import { config } from 'dotenv';
import readline from 'node:readline';
import { sql } from 'drizzle-orm';

config({ path: '.env.local' });

async function confirm(): Promise<boolean> {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  This will DELETE every row in 'applications' and 'reviews'.\n   Truncate? [y/N] `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env.local and try again.');
    process.exit(1);
  }

  if (!(await confirm())) {
    console.log('Cancelled.');
    return;
  }

  // Dynamic import so we don't crash on missing env at module load.
  const { getDb } = await import('../src/db/client');
  const db = getDb();

  console.log('Truncating reviews, applications…');
  await db.execute(sql`TRUNCATE TABLE reviews, applications RESTART IDENTITY CASCADE`);
  console.log('✓ Done. Both tables are empty.');
}

main().catch((e) => {
  console.error('Reset failed:', e);
  process.exit(1);
});

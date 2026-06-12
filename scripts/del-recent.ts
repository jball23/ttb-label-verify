import { tryGetDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { desc, inArray } from 'drizzle-orm';

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 5);
  const db = tryGetDb();
  if (!db) {
    console.error('no db');
    process.exit(1);
  }
  const rows = await db
    .select({ id: applications.id, filename: applications.sourceFilename })
    .from(applications)
    .orderBy(desc(applications.createdAt))
    .limit(limit);
  if (rows.length === 0) {
    console.log('no rows to delete');
    return;
  }
  console.log(
    `deleting ${rows.length} most-recent rows:`,
    rows.map((r) => r.filename),
  );
  await db.delete(applications).where(inArray(applications.id, rows.map((r) => r.id)));
  console.log('done');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { tryGetDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: tsx scripts/del-by-hash.ts <pdf-path>');
    process.exit(1);
  }

  const buf = await fs.readFile(pdfPath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  console.log('content hash:', hash);

  const db = tryGetDb();
  if (!db) {
    console.error('no db (DATABASE_URL not set)');
    process.exit(1);
  }
  const result = await db
    .delete(applications)
    .where(eq(applications.contentHash, hash))
    .returning({ id: applications.id });
  console.log('deleted rows:', result.length, result);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

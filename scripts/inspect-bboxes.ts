import { tryGetDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { desc } from 'drizzle-orm';

async function main(): Promise<void> {
  const db = tryGetDb();
  if (!db) {
    console.error('no db');
    process.exit(1);
  }
  const rows = await db
    .select({
      id: applications.id,
      filename: applications.sourceFilename,
      report: applications.validationReport,
    })
    .from(applications)
    .orderBy(desc(applications.createdAt))
    .limit(3);
  for (const row of rows) {
    console.log(`\n=== ${row.filename} (${row.id}) ===`);
    const r = row.report as {
      pages?: Array<{ pageNumber: number; kind: string }>;
      extractedLabel?: Record<string, unknown>;
      bboxes?: Record<string, { page: number; source: string; words?: unknown[] }>;
      fields?: Record<string, { status: string; reason?: string }>;
    };
    console.log('pages:', r.pages);
    console.log('extracted label:');
    for (const [k, v] of Object.entries(r.extractedLabel ?? {})) {
      console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 80)}`);
    }
    console.log('bboxes:');
    for (const [path, bb] of Object.entries(r.bboxes ?? {})) {
      const words = (bb.words as unknown[] | undefined)?.length ?? 0;
      console.log(`  ${path}: page=${bb.page} source=${bb.source} words=${words}`);
    }
    console.log('rule statuses:');
    for (const [k, v] of Object.entries(r.fields ?? {})) {
      console.log(`  ${k}: ${v.status} ${v.reason ?? ''}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

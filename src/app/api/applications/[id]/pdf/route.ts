import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { tryGetDb } from '@/db/client';
import { applications } from '@/db/schema';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Streams the original PDF bytes for an application.
 *
 * Bytes live in `applications.pdf_bytes` (bytea). The detail page opens
 * this URL inside a modal so a reviewer can re-read the source PDF without
 * re-uploading. Returns 404 when the row is missing OR when pdfBytes is
 * null (rows inserted before the column existed).
 */
export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const db = tryGetDb();
  if (!db) {
    return new Response('Database not configured', { status: 503 });
  }

  const { id } = await params;

  // UUID guard — invalid id strings should 404, not 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const rows = await db
    .select({
      pdfBytes: applications.pdfBytes,
      sourceFilename: applications.sourceFilename,
    })
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);

  const row = rows[0];
  if (!row || !row.pdfBytes) {
    return new Response('PDF not stored for this application', { status: 404 });
  }

  // Drizzle's bytea returns a Buffer; convert to a typed array so the
  // Response stream sees the right byte view.
  const bytes = new Uint8Array(
    row.pdfBytes.buffer,
    row.pdfBytes.byteOffset,
    row.pdfBytes.byteLength,
  );

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${row.sourceFilename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}

import { type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import pLimit from 'p-limit';
import { getExtractor } from '@/lib/extraction/factory';
import { runRules } from '@/lib/validation/engine';
import { encodeNDJSON } from '@/lib/streaming/ndjson';
import {
  validateBatch,
  MAX_BATCH_SIZE,
  isAcceptedMimeType,
} from '@/lib/upload/file-validation';
import { withRequestSpan, withLabelSpan } from '@/lib/observability/spans';
import { PROMPT_VERSION } from '@/lib/extraction/prompt';
import { type ResultLine } from '@/lib/results/result-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CONCURRENCY = 8;

export async function POST(req: NextRequest): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return errorResponse(400, `Malformed multipart body: ${(e as Error).message}`);
  }

  const rawFiles: File[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) rawFiles.push(value);
  }

  const validation = validateBatch(rawFiles);
  if (!validation.ok) {
    return errorResponse(
      rawFiles.length > MAX_BATCH_SIZE ? 413 : 400,
      validation.reason ?? 'Invalid batch.',
    );
  }

  let extractor;
  try {
    extractor = getExtractor();
  } catch (e) {
    return errorResponse(500, (e as Error).message);
  }

  const limit = pLimit(CONCURRENCY);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (line: ResultLine): void => {
        controller.enqueue(encoder.encode(encodeNDJSON(line)));
      };

      // Rejected files surface as error lines first, in original order.
      const indexByName = new Map<string, number>();
      validation.files.forEach((file, idx) => indexByName.set(file.name, idx));
      const baseIndex = validation.files.length;
      validation.rejected.forEach((r, i) => {
        enqueue({
          status: 'error',
          index: baseIndex + i,
          filename: r.file.name,
          durationMs: 0,
          errorMessage: r.reason,
        });
      });

      const wrappedWork = withRequestSpan(
        'verify-request',
        {
          labelCount: validation.files.length,
          promptVersion: PROMPT_VERSION,
        },
        async () => {
          await Promise.all(
            validation.files.map((file, index) =>
              limit(async () => {
                const start = Date.now();
                try {
                  const arrayBuffer = await file.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);
                  const mimeType = isAcceptedMimeType(file.type)
                    ? file.type
                    : 'image/jpeg';
                  const imageSha = crypto
                    .createHash('sha256')
                    .update(buffer)
                    .digest('hex')
                    .slice(0, 16);

                  const extracted = await withLabelSpan(
                    {
                      filename: file.name,
                      mimeType,
                      byteSize: buffer.byteLength,
                      imageSha256: imageSha,
                    },
                    () => extractor.extract(buffer, mimeType),
                  );
                  const report = runRules(extracted);
                  enqueue({
                    status: 'ok',
                    index,
                    filename: file.name,
                    durationMs: Date.now() - start,
                    report,
                  });
                } catch (e) {
                  enqueue({
                    status: 'error',
                    index,
                    filename: file.name,
                    durationMs: Date.now() - start,
                    errorMessage: (e as Error).message,
                  });
                }
              }),
            ),
          );
        },
      );

      wrappedWork
        .catch((e) => {
          // Defensive — withRequestSpan re-throws, but per-label errors are
          // already captured. This only fires on truly unexpected failures.
          enqueue({
            status: 'error',
            index: -1,
            filename: '__batch__',
            durationMs: 0,
            errorMessage: `Batch failed: ${(e as Error).message}`,
          });
        })
        .finally(() => {
          controller.close();
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

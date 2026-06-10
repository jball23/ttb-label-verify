import { type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import pLimit from 'p-limit';
import { getExtractor } from '@/lib/extraction/factory';
import { runVerification } from '@/lib/validation/engine';
import { encodeNDJSON } from '@/lib/streaming/ndjson';
import {
  validateBatch,
  MAX_BATCH_SIZE,
  isAcceptedMimeType,
} from '@/lib/upload/file-validation';
import { withRequestSpan, withLabelSpan } from '@/lib/observability/spans';
import { PROMPT_VERSION } from '@/lib/extraction/prompt';
import { type ResultLine } from '@/lib/results/result-types';
import { scrubError } from '@/lib/safety/scrub-error';
import {
  parseApplication,
  InvalidApplicationError,
} from '@/lib/application/loader';
import { type Application } from '@/lib/application/types';

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

  // Application JSON is required. Read + validate before doing any file work
  // so a bad application fails fast without consuming an extractor token.
  const applicationField = formData.get('application');
  if (applicationField == null) {
    return errorResponse(
      400,
      'Missing "application" field. POST a multipart form with the filled COLA application JSON in an "application" field alongside the label image.',
    );
  }
  if (typeof applicationField !== 'string') {
    return errorResponse(400, 'The "application" field must be a JSON string, not a file.');
  }
  let application: Application;
  try {
    application = parseApplication(JSON.parse(applicationField));
  } catch (e) {
    if (e instanceof InvalidApplicationError) {
      return errorResponse(400, e.message);
    }
    if (e instanceof SyntaxError) {
      return errorResponse(400, `Could not parse application JSON: ${e.message}`);
    }
    return errorResponse(400, `Application validation failed: ${(e as Error).message}`);
  }

  const rawFiles: File[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) rawFiles.push(value);
  }

  // The cross-check pipeline is single-label-per-application by design (the
  // demo dataset is 1:1, and a single application typically belongs to one
  // primary brand label). Reject multi-label submissions explicitly so the
  // demo's contract is unambiguous.
  if (rawFiles.length > 1) {
    return errorResponse(
      400,
      'Single-label submissions only when an application is attached. Submit one label image per application.',
    );
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
          applicationScenarioId: application.scenarioId,
          applicationProductType: application.form.productType,
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
                  const report = runVerification(application, extracted);
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
                    errorMessage: scrubError(humanizeExtractionError(e as Error)),
                  });
                }
              }),
            ),
          );
        },
      );

      wrappedWork
        .catch((e) => {
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
  return new Response(JSON.stringify({ error: scrubError(message) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Map provider SDK errors to user-friendly messages so the UI doesn't read like
 * a stack trace. Falls through to the raw message (which is then scrub'd).
 */
function humanizeExtractionError(error: Error): string {
  const raw = error.message;
  if (/invalid.*header|invalid_api_key|incorrect api key|401|unauthorized/i.test(raw)) {
    return 'The AI provider rejected the request. Check the OPENAI_API_KEY in your environment.';
  }
  if (/rate limit|429/i.test(raw)) {
    return 'AI provider rate limit hit. Wait a few seconds and try again.';
  }
  if (/timeout|timed out/i.test(raw)) {
    return 'The AI provider timed out reading this label. Try a smaller or clearer image.';
  }
  if (/safety|content_policy|content policy/i.test(raw)) {
    return 'The AI provider declined to process this image. It may have flagged the content.';
  }
  return raw;
}

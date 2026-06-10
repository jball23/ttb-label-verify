import { type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getExtractor } from '@/lib/extraction/factory';
import { runVerification } from '@/lib/validation/engine';
import { encodeNDJSON } from '@/lib/streaming/ndjson';
import { withRequestSpan, withLabelSpan } from '@/lib/observability/spans';
import { PROMPT_VERSION } from '@/lib/extraction/prompt';
import { type ResultLine } from '@/lib/results/result-types';
import { scrubError } from '@/lib/safety/scrub-error';
import { synthesizeExpectations } from '@/lib/application/loader';
import { renderPageOne, PdfRenderError } from '@/lib/pdf/render';
import { snapApplicationProvenance } from '@/lib/pdf/form-widgets';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB headroom for a multi-page COLA PDF

export async function POST(req: NextRequest): Promise<Response> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return errorResponse(400, `Malformed multipart body: ${(e as Error).message}`);
  }

  const pdfField = formData.get('pdf');
  if (pdfField == null) {
    return errorResponse(
      400,
      'Missing "pdf" field. POST a multipart form with the filled COLA application PDF in a "pdf" field.',
    );
  }
  if (!(pdfField instanceof File)) {
    return errorResponse(400, 'The "pdf" field must be a file upload, not a string.');
  }
  if (pdfField.type && pdfField.type !== 'application/pdf') {
    return errorResponse(
      400,
      `Expected application/pdf, got "${pdfField.type}". The verifier accepts a single filled COLA application PDF.`,
    );
  }
  if (pdfField.size === 0) {
    return errorResponse(400, 'PDF file is empty.');
  }
  if (pdfField.size > MAX_PDF_BYTES) {
    return errorResponse(
      413,
      `PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  let extractor;
  try {
    extractor = getExtractor();
  } catch (e) {
    return errorResponse(500, (e as Error).message);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (line: ResultLine): void => {
        controller.enqueue(encoder.encode(encodeNDJSON(line)));
      };

      const wrappedWork = withRequestSpan(
        'verify-request',
        {
          labelCount: 1,
          promptVersion: PROMPT_VERSION,
        },
        async () => {
          const start = Date.now();
          try {
            const arrayBuffer = await pdfField.arrayBuffer();
            const pdfBuffer = Buffer.from(arrayBuffer);
            const pdfSha = crypto
              .createHash('sha256')
              .update(pdfBuffer)
              .digest('hex')
              .slice(0, 16);

            const pngBuffer = await renderPageOne(pdfBuffer);

            const extracted = await withLabelSpan(
              {
                filename: pdfField.name,
                mimeType: 'image/png',
                byteSize: pngBuffer.byteLength,
                imageSha256: pdfSha,
              },
              () => extractor.extract(pngBuffer),
            );

            const application = synthesizeExpectations(extracted.application);
            // Override the model's application-side bboxes with deterministic
            // AcroForm widget rects; label-side bboxes stay vision-LLM.
            const snappedProvenance = snapApplicationProvenance(extracted.provenance);
            const report = runVerification(
              application,
              extracted.label,
              snappedProvenance,
            );

            enqueue({
              status: 'ok',
              index: 0,
              filename: pdfField.name,
              durationMs: Date.now() - start,
              report,
            });
          } catch (e) {
            enqueue({
              status: 'error',
              index: 0,
              filename: pdfField.name,
              durationMs: Date.now() - start,
              errorMessage: scrubError(humanizeError(e as Error)),
            });
          }
        },
      );

      wrappedWork
        .catch((e) => {
          enqueue({
            status: 'error',
            index: -1,
            filename: '__request__',
            durationMs: 0,
            errorMessage: `Verify failed: ${(e as Error).message}`,
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

function humanizeError(error: Error): string {
  const raw = error.message;
  if (error instanceof PdfRenderError) {
    return `Could not render the PDF: ${raw}. Confirm it's a valid filled COLA application.`;
  }
  if (/invalid.*header|invalid_api_key|incorrect api key|401|unauthorized/i.test(raw)) {
    return 'The AI provider rejected the request. Check the OPENAI_API_KEY in your environment.';
  }
  if (/rate limit|429/i.test(raw)) {
    return 'AI provider rate limit hit. Wait a few seconds and try again.';
  }
  if (/timeout|timed out/i.test(raw)) {
    return 'The AI provider timed out reading this PDF. Try a smaller or clearer file.';
  }
  if (/safety|content_policy|content policy/i.test(raw)) {
    return 'The AI provider declined to process this image. It may have flagged the content.';
  }
  return raw;
}

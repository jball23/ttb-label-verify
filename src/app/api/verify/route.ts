import { type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getExtractor } from '@/lib/extraction/factory';
import { runVerification } from '@/lib/validation/engine';
import { encodeNDJSON } from '@/lib/streaming/ndjson';
import { withRequestSpan, withLabelSpan } from '@/lib/observability/spans';
import { getPromptVersion } from '@/lib/extraction/prompt';
import { type ResultLine } from '@/lib/results/result-types';
import { scrubError } from '@/lib/safety/scrub-error';
import { renderApplicationPages, PdfRenderError } from '@/lib/pdf/render';
import { parseApplicationFormFromRenderedPages } from '@/lib/pdf/parse-form';
import { snapApplicationProvenance } from '@/lib/pdf/form-widgets';
import { persistVerification } from '@/db/persist-verification';
import { findApplicationByProcessingRun } from '@/db/applications';
import { tryGetDb } from '@/db/client';
import { getEnv } from '@/lib/env';
import { synthesizeExpectations } from '@/lib/application/loader';
import type { ProvenanceMap } from '@/lib/extraction/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB headroom for a multi-page COLA PDF
let verifyQueue: Promise<void> = Promise.resolve();

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

      const includeProvenance = getEnv().EXTRACT_PROVENANCE;
      const promptVersion = getPromptVersion(includeProvenance);

      const wrappedWork = withRequestSpan(
        'verify-request',
        {
          labelCount: 1,
          promptVersion,
        },
        async () => {
          const start = Date.now();
          const timings: Record<string, number> = {};
          const mark = (label: string, since: number): void => {
            timings[label] = Date.now() - since;
          };
          try {
            const arrayBuffer = await pdfField.arrayBuffer();
            const pdfBuffer = Buffer.from(arrayBuffer);
            const pdfShaFull = crypto
              .createHash('sha256')
              .update(pdfBuffer)
              .digest('hex');
            const pdfSha = pdfShaFull.slice(0, 16);

            // Cache hit: reuse only the same PDF under the same extraction
            // pipeline. Tesseract/parser updates can change field values and
            // bboxes without changing the PDF bytes, so content hash alone
            // would pin reviewers to stale results.
            if (tryGetDb()) {
              const existing = await findApplicationByProcessingRun(
                pdfShaFull,
                promptVersion,
                extractor.modelId,
              );
              if (existing) {
                enqueue({
                  status: 'ok',
                  index: 0,
                  filename: pdfField.name,
                  durationMs: Date.now() - start,
                  report: existing.validationReport,
                  applicationId: existing.id,
                });
                return;
              }
            }

            const queueStart = Date.now();
            await runOneVerificationAtATime(async () => {
              mark('queue', queueStart);
              const renderStart = Date.now();
              const renderedPages = await renderApplicationPages(pdfBuffer);
              mark('render', renderStart);
              const parseStart = Date.now();
              const parsedForm = await parseApplicationFormFromRenderedPages(
                renderedPages,
              );
              mark('parse', parseStart);
              const pngBuffers = renderedPages.map((p) => p.png);
              const totalPngBytes = pngBuffers.reduce(
                (sum, b) => sum + b.byteLength,
                0,
              );

              const llmStart = Date.now();
              const extracted = await withLabelSpan(
                {
                  filename: pdfField.name,
                  mimeType: 'image/png',
                  byteSize: totalPngBytes,
                  imageSha256: pdfSha,
                },
                () =>
                  extractor.extract(renderedPages, { parsedForm }),
              );
              mark('llm', llmStart);

              const provenance: ProvenanceMap = includeProvenance
                ? snapApplicationProvenance(extracted.provenance)
                : {};
              const application = synthesizeExpectations(extracted.application);
              const report = runVerification(
                application,
                extracted.label,
                provenance,
                extracted.application,
                extracted.bboxes,
                renderedPages.map((p) => ({ pageNumber: p.pageNumber, kind: p.kind })),
              );

              const latencyMs = Date.now() - start;
              const pagesLog = renderedPages
                .map((p) => `${p.pageNumber}:${p.kind}`)
                .join(',');
              // eslint-disable-next-line no-console -- structured per-request observability marker; HANDOFF references the `[verify]` log line for diagnostics.
              console.log(
                `[verify] ${pdfField.name} model=${extractor.modelId} bbox=${includeProvenance ? 'on' : 'off'} formPrepass=${parsedForm ? 'hit' : 'miss'} pages=[${pagesLog}] total=${latencyMs}ms queue=${timings.queue ?? 0}ms render=${timings.render ?? 0}ms parse=${timings.parse ?? 0}ms llm=${timings.llm ?? 0}ms`,
              );
              const applicationId = await persistVerification({
                sourceFilename: pdfField.name,
                contentHash: pdfShaFull,
                byteSize: pdfField.size,
                promptVersion,
                extractorModel: extractor.modelId,
                latencyMs,
                extracted: { ...extracted, provenance },
                report,
                pdfBytes: pdfBuffer,
              });

              enqueue({
                status: 'ok',
                index: 0,
                filename: pdfField.name,
                durationMs: latencyMs,
                report,
                applicationId,
              });
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

async function runOneVerificationAtATime<T>(work: () => Promise<T>): Promise<T> {
  const previous = verifyQueue.catch(() => undefined);
  let release: () => void = () => undefined;
  verifyQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await work();
  } finally {
    release();
  }
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

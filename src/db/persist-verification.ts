import { tryGetDb } from './client';
import { applications, aiVerdictToInitialStatus, type AiVerdict } from './schema';
import type { ExtractedDocument } from '@/lib/extraction/types';
import type { VerificationReport } from '@/lib/validation/types';

export interface PersistVerificationInput {
  sourceFilename: string;
  contentHash: string;
  byteSize: number;
  promptVersion: string;
  extractorModel: string;
  latencyMs: number;
  extracted: ExtractedDocument;
  report: VerificationReport;
  pdfBytes: Buffer;
}

/**
 * Persist a successful verification run. No-ops silently when DATABASE_URL
 * is not configured so the demo continues working DB-less.
 *
 * Never throws — persistence failures must not break the user-facing
 * verification response. Returns the new row id, or null on no-op / failure.
 */
export async function persistVerification(
  input: PersistVerificationInput,
): Promise<string | null> {
  const db = tryGetDb();
  if (!db) return null;

  try {
    // Three-tier mapping. `non_compliant` is a genuine reject; `needs_review`
    // surfaces in the queue but defaults to approve (TTB approves plenty of
    // labels with minor format quirks or asymmetric data). See the verdict
    // routing notes in `runVerification`.
    const overall = input.report.overallStatus;
    const aiVerdict: AiVerdict =
      overall === 'compliant'
        ? 'compliant'
        : overall === 'non_compliant'
          ? 'non_compliant'
          : 'needs_review';
    const currentStatus = aiVerdictToInitialStatus(aiVerdict);

    const applicantName = input.extracted.application.applicant.name;
    const brandName =
      input.extracted.application.brandName ??
      input.extracted.label.brandName;

    const [row] = await db
      .insert(applications)
      .values({
        sourceFilename: input.sourceFilename,
        contentHash: input.contentHash,
        byteSize: input.byteSize,
        promptVersion: input.promptVersion,
        extractorModel: input.extractorModel,
        latencyMs: input.latencyMs,
        extractedForm: input.extracted.application,
        extractedLabel: input.extracted.label,
        validationReport: input.report,
        aiVerdict,
        currentStatus,
        brandName,
        applicantName,
        ttbSerialNumber: input.extracted.application.serialNumber,
        pdfBytes: input.pdfBytes,
      })
      .returning({ id: applications.id });

    return row?.id ?? null;
  } catch (e) {
    // Persistence is best-effort. Log but don't disrupt the response.
    console.error('[persistVerification] insert failed:', e);
    return null;
  }
}

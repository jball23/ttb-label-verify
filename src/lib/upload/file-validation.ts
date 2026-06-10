/**
 * Pure file-validation logic. Shared between the server route handler and the
 * client upload zone — the same rules apply, the same error messages render.
 */

export const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export const MAX_BATCH_SIZE = 25;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface AcceptedFile {
  file: File;
}

export interface RejectedFile {
  file: File;
  reason: string;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  files: File[];
  rejected: RejectedFile[];
}

export function validateBatch(files: File[]): ValidationResult {
  if (files.length === 0) {
    return {
      ok: false,
      reason: 'At least one label image is required.',
      files: [],
      rejected: [],
    };
  }
  if (files.length > MAX_BATCH_SIZE) {
    return {
      ok: false,
      reason: `Maximum ${MAX_BATCH_SIZE} labels per batch.`,
      files: [],
      rejected: [],
    };
  }

  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const rejection = validateOne(file);
    if (rejection) {
      rejected.push({ file, reason: rejection });
    } else {
      accepted.push(file);
    }
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      reason: 'No valid files in upload. See per-file errors.',
      files: [],
      rejected,
    };
  }

  return { ok: true, files: accepted, rejected };
}

function validateOne(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`;
  }
  if (!isAcceptedMimeType(file.type)) {
    return 'Unsupported file type. Use PNG, JPG, WebP, or PDF.';
  }
  return null;
}

export function isAcceptedMimeType(mimeType: string): mimeType is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

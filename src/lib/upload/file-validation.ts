/**
 * Label-image upload rules, shared by the browser (before upload) and the
 * server (on receipt) so both enforce the same limits with the same words.
 */
import { LABEL_IMAGE_MIME_TYPES, type LabelImageMimeType } from '@/lib/labels/label-reader';

/** Importers send 200–300 labels at once in peak season. */
export const MAX_BATCH_SIZE = 500;
/** Images are downscaled in the browser first, so this is generous. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function isLabelImageMimeType(mimeType: string): mimeType is LabelImageMimeType {
  return (LABEL_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** A reason the file cannot be checked, or null when it is acceptable. */
export function validateLabelFile(file: { size: number; type: string }): string | null {
  if (!isLabelImageMimeType(file.type)) return 'This is not a label photo. Use a JPG, PNG or WebP image.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_FILE_BYTES) return `This image is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  return null;
}

export interface FilePartition<F> {
  accepted: F[];
  rejected: Array<{ file: F; reason: string }>;
}

/** Splits a selection into checkable files and per-file rejections. */
export function partitionLabelFiles<F extends { size: number; type: string }>(files: F[]): FilePartition<F> {
  const partition: FilePartition<F> = { accepted: [], rejected: [] };
  for (const [index, file] of files.entries()) {
    const reason =
      index >= MAX_BATCH_SIZE ? `Only ${MAX_BATCH_SIZE} labels can be checked at once.` : validateLabelFile(file);
    if (reason) partition.rejected.push({ file, reason });
    else partition.accepted.push(file);
  }
  return partition;
}

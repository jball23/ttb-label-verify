import { type LabelReading } from './reading';

export const LABEL_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type LabelImageMimeType = (typeof LABEL_IMAGE_MIME_TYPES)[number];

export interface LabelImage {
  bytes: Buffer;
  mimeType: LabelImageMimeType;
}

/**
 * Reads the regulated fields off one label image. Implementations own the
 * provider details; callers depend only on this interface.
 */
export interface LabelReader {
  /** Identifies the model/provider in persisted results, e.g. "openai:gpt-5.4-mini". */
  readonly modelId: string;
  read(image: LabelImage): Promise<LabelReading>;
  /**
   * A second, focused transcription of only the government warning, used to
   * confirm before failing a label on its wording. Null when there is none.
   */
  readWarning(image: LabelImage): Promise<string | null>;
}

/**
 * Browser-side: shrink a label photo before upload. Phone photos are often
 * 4000+ px and several MB; reading a label needs far less, and a smaller
 * image uploads faster and is read faster by the model.
 */

export const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;

/** The target size for an image, never enlarging it. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Returns a JPEG no larger than MAX_EDGE_PX on its long edge, or the
 * original file if it is already small enough or cannot be decoded here
 * (the server still validates it).
 */
export async function prepareImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (width === bitmap.width && file.type === 'image/jpeg') return file;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
    });
    // Keep whichever is smaller; re-encoding a small image can make it bigger.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } finally {
    bitmap.close();
  }
}

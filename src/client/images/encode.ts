import { withDeadline } from '../api';
import { isHeic } from './heic';

export async function encodePhoto(canvas: HTMLCanvasElement) {
  const blob = await withDeadline(
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(
                new Error('Could not prepare this photo. Please try again.'),
              ),
        'image/webp',
        0.92,
      );
    }),
    undefined,
    {
      milliseconds: 30_000,
      message:
        'This photo took too long to prepare. Try again or choose a smaller photo.',
    },
  );
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
    throw new Error('This browser could not save a supported photo.');
  if (blob.size > 8 * 1024 * 1024)
    throw new Error('The cropped photo is too large. Choose a smaller crop.');
  return blob;
}

// What reopening the crop should decode. A HEIC original is decoded only
// once: decoding it again is slow and memory-hungry, and can fail on phones.
// Later crops use a JPEG of the already-decoded pixels, at the same
// dimensions, so the saved crop rectangle still applies. Falls back to the
// original when the copy cannot be made.
export async function recropSource(file: File, image: ImageBitmap) {
  if (!isHeic(file)) return file;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0);
    const blob = await withDeadline(
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.95),
      ),
      undefined,
      { milliseconds: 30_000, message: 'Timed out' },
    );
    if (blob?.type !== 'image/jpeg') return file;
    return new File([blob], 'photo.jpg', { type: blob.type });
  } catch {
    return file;
  }
}

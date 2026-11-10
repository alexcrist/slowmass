import { withDeadline } from '../api';
import { decodeHeicInWorker, isHeic } from './heic';

// File inputs list HEIC by extension too: not every system maps its type.
export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

// Uploads are at most 1600px, so this keeps detail for tight crops while
// bounding what the crop editor holds for very large originals.
const WORKING_EDGE = 4096;

async function boundBitmap(bitmap: ImageBitmap) {
  const scale = WORKING_EDGE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return bitmap;
  let smaller: ImageBitmap;
  try {
    smaller = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      resizeQuality: 'high',
    });
  } catch {
    // Still usable at full size.
    return bitmap;
  }
  bitmap.close();
  return smaller;
}

// No size limits on the original: any photo the device can decode is accepted
// and reduced here. One too large for the device's memory fails to open.
export async function decodePhoto(file: File) {
  const heic = isHeic(file);
  if (!heic && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo.');
  let expired = false;
  const fallback = new AbortController();
  try {
    const native = createImageBitmap(file, { imageOrientation: 'from-image' });
    return await withDeadline(
      // Only some browsers open HEIC themselves.
      (heic
        ? native.catch((error: unknown) => {
            if (expired) throw error;
            return decodeHeicInWorker(file, fallback.signal);
          })
        : native
      )
        .then(boundBitmap)
        .then((image) => {
          if (expired) image.close();
          return image;
        }),
      undefined,
      {
        milliseconds: 30_000,
        message:
          'This photo took too long to open. Try again or choose a smaller photo.',
      },
    );
  } catch {
    expired = true;
    fallback.abort();
    throw new Error(
      'This photo could not be opened. Try again or choose a smaller JPEG, PNG, WebP, or HEIC photo.',
    );
  }
}

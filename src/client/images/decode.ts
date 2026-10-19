import { withDeadline } from '../api';

export async function decodePhoto(file: File) {
  // Bound local originals separately from the smaller, encoded upload.
  if (file.size > 32 * 1024 * 1024)
    throw new Error('Choose a photo no larger than 32 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  let bitmap: ImageBitmap;
  let expired = false;
  try {
    bitmap = await withDeadline(
      createImageBitmap(file, { imageOrientation: 'from-image' }).then(
        (image) => {
          if (expired) image.close();
          return image;
        },
      ),
      undefined,
      {
        milliseconds: 30_000,
        message:
          'This photo took too long to open. Try again or choose a smaller photo.',
      },
    );
  } catch {
    expired = true;
    throw new Error(
      'This photo could not be opened. Try again or choose a smaller JPEG, PNG, or WebP photo.',
    );
  }
  if (
    bitmap.width < 1 ||
    bitmap.height < 1 ||
    bitmap.width * bitmap.height > 40_000_000
  ) {
    bitmap.close();
    throw new Error('Choose a photo with no more than 40 megapixels.');
  }
  return bitmap;
}

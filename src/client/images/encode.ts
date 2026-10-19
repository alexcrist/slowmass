import { withDeadline } from '../api';

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

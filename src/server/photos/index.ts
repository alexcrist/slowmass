export { privatePhoto } from './delivery';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 40_000_000;

export class PhotoError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 422 | 503,
  ) {
    super(message);
  }
}

// Bound each external await against the same phase deadline. A late result
// cannot resume the pipeline, write objects, or publish an unvalidated photo.
export async function photoDeadline<T>(
  promise: Promise<T>,
  expiresAt: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PhotoError(message, 503)),
          Math.max(0, expiresAt - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

// Inspect container framing only. The Images service still decodes and validates pixels.
export function inspectContainer(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw new PhotoError('Choose a photo smaller than 8 MB.', 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, size: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + size));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return;
  if (bytes.length >= 20 && text(0, 8) === '\x89PNG\r\n\x1a\n') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset);
      const type = text(offset + 4, 4);
      if (offset + size + 12 > bytes.length) break;
      if (['acTL', 'fcTL', 'fdAT'].includes(type))
        throw new PhotoError('Animated images are not supported.', 422);
      offset += size + 12;
      if (type === 'IEND' && size === 0 && offset === bytes.length) return;
    }
    throw new PhotoError('This PNG file is incomplete or unsupported.', 422);
  }
  if (bytes.length >= 20 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.length)
      throw new PhotoError('This WebP file is incomplete.', 422);
    let offset = 12;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset + 4, true);
      const type = text(offset, 4);
      if (offset + size + 8 > end) break;
      if (
        type === 'ANIM' ||
        type === 'ANMF' ||
        (type === 'VP8X' && size > 0 && bytes[offset + 8] & 2)
      )
        throw new PhotoError('Animated images are not supported.', 422);
      offset += 8 + size + (size % 2);
    }
    if (offset === end) return;
    throw new PhotoError('This WebP file is incomplete.', 422);
  }
  throw new PhotoError(
    'Choose a still JPEG, PNG, or WebP photo. Convert HEIC files before uploading.',
    422,
  );
}

export async function processPhoto(
  images: ImagesBinding,
  bytes: Uint8Array,
  size = 1600,
) {
  inspectContainer(bytes);
  const expiresAt = Date.now() + 30_000;
  const wait = <T>(promise: Promise<T>) =>
    photoDeadline(
      promise,
      expiresAt,
      'Photo processing took too long. Choose the photo again to start a new upload.',
    );
  const stream = () => new Blob([new Uint8Array(bytes)]).stream();
  let info: ImageInfoResponse;
  try {
    info = await wait(images.info(stream()));
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    const invalid =
      error instanceof Error &&
      'code' in error &&
      [9412, 9516].includes(Number(error.code));
    throw new PhotoError(
      invalid
        ? 'The photo could not be decoded. Check the file and try again.'
        : 'Photo inspection is unavailable. Please try again later.',
      invalid ? 422 : 503,
    );
  }
  if (
    !('width' in info) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(info.format)
  )
    throw new PhotoError('Choose a still JPEG, PNG, or WebP photo.', 422);
  if (
    info.width < 1 ||
    info.height < 1 ||
    info.width * info.height > MAX_PHOTO_PIXELS
  )
    throw new PhotoError(
      'Choose a photo with no more than 40 megapixels.',
      413,
    );
  // WebP output strips metadata; the processor applies EXIF orientation before resizing.
  try {
    const result = await wait(
      images
        .input(stream())
        .transform({ width: size, height: size, fit: 'scale-down' })
        .output({ format: 'image/webp', quality: 82, anim: false }),
    );
    const output = new Uint8Array(await wait(result.response().arrayBuffer()));
    if (output.length > MAX_PHOTO_BYTES) throw new Error('Output too large');
    const dimensions = await wait(images.info(new Blob([output]).stream()));
    if (!('width' in dimensions) || dimensions.format !== 'image/webp')
      throw new Error('Invalid output');
    return {
      bytes: output,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError(
      'Photo processing is unavailable. Please try again later.',
      503,
    );
  }
}

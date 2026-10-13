export async function decodePhoto(file: File) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error('Choose a photo smaller than 8 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo could not be opened. Choose another file.');
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

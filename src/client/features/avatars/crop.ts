export { decodePhoto } from '../../images/decode';
export type Crop = { zoom: number; x: number; y: number };
export const initialCrop: Crop = { zoom: 1, x: 0.5, y: 0.5 };
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function cropRectangle(width: number, height: number, crop: Crop) {
  const size = Math.max(
    1,
    Math.floor(Math.min(width, height) / clamp(crop.zoom, 1, 4)),
  );
  return {
    x: clamp(Math.round(crop.x * width - size / 2), 0, width - size),
    y: clamp(Math.round(crop.y * height - size / 2), 0, height - size),
    size,
  };
}

// Pointer movement is a fraction of the preview width/height; the photo follows the pointer.
export function moveCrop(
  width: number,
  height: number,
  crop: Crop,
  dx: number,
  dy: number,
): Crop {
  const rect = cropRectangle(width, height, crop);
  return {
    ...crop,
    x: clamp(
      (rect.x + rect.size / 2 - dx * rect.size) / width,
      rect.size / 2 / width,
      1 - rect.size / 2 / width,
    ),
    y: clamp(
      (rect.y + rect.size / 2 - dy * rect.size) / height,
      rect.size / 2 / height,
      1 - rect.size / 2 / height,
    ),
  };
}

export function drawCrop(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  crop: Crop,
) {
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Photo cropping is unavailable in this browser.');
  const rect = cropRectangle(image.width, image.height, crop);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

export async function encodeCrop(image: ImageBitmap, crop: Crop) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(
    1600,
    cropRectangle(image.width, image.height, crop).size,
  );
  drawCrop(canvas, image, crop);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error('The cropped photo could not be saved. Try again.'),
            ),
      'image/webp',
      0.92,
    ),
  );
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
    throw new Error(
      'This browser could not encode the photo. Try another browser.',
    );
  if (blob.size > 8 * 1024 * 1024)
    throw new Error('The cropped photo is too large. Choose a smaller photo.');
  return blob;
}

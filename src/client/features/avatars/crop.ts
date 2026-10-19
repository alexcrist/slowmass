import { encodePhoto } from '../../images/encode';
export { decodePhoto } from '../../images/decode';
export type Crop = { zoom: number; x: number; y: number };
export type CropPoint = { x: number; y: number };
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

// Keep fractional source coordinates during gestures; rounding every pointer
// event accumulates drift. Only rasterization rounds to whole image pixels.
function gestureRectangle(width: number, height: number, crop: Crop) {
  const size = Math.max(1, Math.min(width, height) / clamp(crop.zoom, 1, 4));
  return {
    x: clamp(crop.x * width - size / 2, 0, width - size),
    y: clamp(crop.y * height - size / 2, 0, height - size),
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
  const rect = gestureRectangle(width, height, crop);
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

// Points are fractions of the square preview. Keep the source point beneath
// the old midpoint beneath the new midpoint while changing the magnification.
export function pinchCrop(
  width: number,
  height: number,
  crop: Crop,
  from: readonly [CropPoint, CropPoint],
  to: readonly [CropPoint, CropPoint],
): Crop {
  const distance = (points: readonly [CropPoint, CropPoint]) =>
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const before = distance(from);
  const after = distance(to);
  const zoom = clamp(
    crop.zoom * (before > 0 && after > 0 ? after / before : 1),
    1,
    4,
  );
  const rect = gestureRectangle(width, height, crop);
  const size = gestureRectangle(width, height, { ...crop, zoom }).size;
  return {
    zoom,
    x: clamp(
      (rect.x +
        ((from[0].x + from[1].x) / 2) * rect.size +
        (0.5 - (to[0].x + to[1].x) / 2) * size) /
        width,
      size / 2 / width,
      1 - size / 2 / width,
    ),
    y: clamp(
      (rect.y +
        ((from[0].y + from[1].y) / 2) * rect.size +
        (0.5 - (to[0].y + to[1].y) / 2) * size) /
        height,
      size / 2 / height,
      1 - size / 2 / height,
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
  return encodePhoto(canvas);
}

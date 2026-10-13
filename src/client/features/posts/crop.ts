export type Rectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type CropHandle =
  'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export const fullPhoto: Rectangle = { left: 0, top: 0, right: 1, bottom: 1 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// Coordinates are fractions of the oriented image, independent of preview size.
export function adjustRectangle(
  rect: Rectangle,
  handle: CropHandle,
  dx: number,
  dy: number,
): Rectangle {
  if (handle === 'move') {
    const x = clamp(dx, -rect.left, 1 - rect.right);
    const y = clamp(dy, -rect.top, 1 - rect.bottom);
    return {
      left: rect.left + x,
      right: rect.right + x,
      top: rect.top + y,
      bottom: rect.bottom + y,
    };
  }
  const next = { ...rect };
  const minimum = 0.1;
  if (handle.includes('w'))
    next.left = clamp(rect.left + dx, 0, rect.right - minimum);
  if (handle.includes('e'))
    next.right = clamp(rect.right + dx, rect.left + minimum, 1);
  if (handle.includes('n'))
    next.top = clamp(rect.top + dy, 0, rect.bottom - minimum);
  if (handle.includes('s'))
    next.bottom = clamp(rect.bottom + dy, rect.top + minimum, 1);
  return next;
}

export function pixelRectangle(width: number, height: number, rect: Rectangle) {
  const x = clamp(Math.round(rect.left * width), 0, width - 1);
  const y = clamp(Math.round(rect.top * height), 0, height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(rect.right * width), x + 1, width) - x,
    height: clamp(Math.round(rect.bottom * height), y + 1, height) - y,
  };
}

export async function encodePostCrop(image: ImageBitmap, rect: Rectangle) {
  const crop = pixelRectangle(image.width, image.height, rect);
  const scale = Math.min(1, 1600 / Math.max(crop.width, crop.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Photo cropping is unavailable in this browser.');
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('Could not save this crop. Please try again.'));
      },
      'image/webp',
      0.92,
    );
  });
  if (blob.size > 8 * 1024 * 1024)
    throw new Error('The cropped photo is too large. Choose a smaller crop.');
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
    throw new Error('This browser could not save a supported photo.');
  return new File(
    [blob],
    `photo.${blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg'}`,
    { type: blob.type },
  );
}

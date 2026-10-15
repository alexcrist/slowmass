import { afterEach, expect, it, vi } from 'vitest';
import {
  cropRectangle,
  decodePhoto,
  drawCrop,
  encodeCrop,
  initialCrop,
  moveCrop,
  pinchCrop,
} from './crop';
afterEach(() => vi.unstubAllGlobals());
it('centers square crops for landscape and portrait photos and clamps zoomed crops to image bounds', () => {
  expect(cropRectangle(1200, 800, initialCrop)).toEqual({
    x: 200,
    y: 0,
    size: 800,
  });
  expect(cropRectangle(800, 1200, initialCrop)).toEqual({
    x: 0,
    y: 200,
    size: 800,
  });
  expect(cropRectangle(1200, 800, { zoom: 2, x: 1, y: 0 })).toEqual({
    x: 800,
    y: 0,
    size: 400,
  });
  expect(cropRectangle(1200, 800, { zoom: 100, x: -5, y: 5 })).toEqual({
    x: 0,
    y: 600,
    size: 200,
  });
});
it('moves the image with pointer fractions and stops at edges without accumulating hidden movement', () => {
  const right = moveCrop(1200, 800, initialCrop, 10, 0);
  expect(cropRectangle(1200, 800, right)).toEqual({ x: 0, y: 0, size: 800 });
  const back = moveCrop(1200, 800, right, -0.1, 0);
  expect(cropRectangle(1200, 800, back).x).toBe(80);
});
it('pinches around an off-center midpoint and moves that source point with both fingers', () => {
  const crop = pinchCrop(
    1200,
    800,
    initialCrop,
    [
      { x: 0.2, y: 0.25 },
      { x: 0.4, y: 0.25 },
    ],
    [
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.5 },
    ],
  );
  expect(crop.zoom).toBeCloseTo(2);
  const rect = cropRectangle(1200, 800, crop);
  expect(rect.size).toBe(400);
  // The original source point (440, 200) stays under the new midpoint.
  expect(rect.x + rect.size / 2).toBe(440);
  expect(rect.y + rect.size / 2).toBe(200);
});
it('bounds pinch zoom and position, allowing immediate reversal at the limits', () => {
  const start = [
    { x: 0.25, y: 0.5 },
    { x: 0.75, y: 0.5 },
  ] as const;
  const far = [
    { x: -2, y: 0.5 },
    { x: 3, y: 0.5 },
  ] as const;
  const zoomed = pinchCrop(800, 1200, initialCrop, start, far);
  expect(zoomed.zoom).toBe(4);
  const reversed = pinchCrop(800, 1200, zoomed, far, [
    { x: -1.5, y: 0.5 },
    { x: 2.5, y: 0.5 },
  ]);
  expect(reversed.zoom).toBeCloseTo(3.2);
  const zoomedOut = pinchCrop(800, 1200, zoomed, far, start);
  expect(zoomedOut.zoom).toBe(1);
  const edge = pinchCrop(800, 1200, zoomed, start, [
    { x: 10.25, y: 10.5 },
    { x: 10.75, y: 10.5 },
  ]);
  expect(cropRectangle(800, 1200, edge)).toEqual({ x: 0, y: 0, size: 200 });
  const back = pinchCrop(
    800,
    1200,
    edge,
    [
      { x: 10.25, y: 10.5 },
      { x: 10.75, y: 10.5 },
    ],
    [
      { x: 10.15, y: 10.4 },
      { x: 10.65, y: 10.4 },
    ],
  );
  expect(cropRectangle(800, 1200, back)).toEqual({ x: 20, y: 20, size: 200 });
});
it('keeps overlapping pinch points finite without an abrupt zoom', () => {
  const overlap = [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ] as const;
  const apart = [
    { x: 0.25, y: 0.5 },
    { x: 0.75, y: 0.5 },
  ] as const;
  expect(pinchCrop(1200, 800, initialCrop, overlap, apart)).toEqual(
    initialCrop,
  );
  expect(pinchCrop(1200, 800, initialCrop, apart, overlap)).toEqual(
    initialCrop,
  );
});
it('validates files, respects EXIF orientation, and releases overlarge decoded images', async () => {
  const close = vi.fn();
  const decode = vi.fn().mockResolvedValue({ width: 1000, height: 500, close });
  vi.stubGlobal('createImageBitmap', decode);
  const photo = new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' });
  await decodePhoto(photo);
  expect(decode).toHaveBeenCalledWith(photo, {
    imageOrientation: 'from-image',
  });
  await expect(
    decodePhoto(new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })),
  ).rejects.toThrow('JPEG');
  await expect(
    decodePhoto(
      new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      }),
    ),
  ).rejects.toThrow('32 MB');
  expect(decode).toHaveBeenCalledTimes(1);
  decode.mockResolvedValue({ width: 10000, height: 10000, close });
  await expect(decodePhoto(photo)).rejects.toThrow('40 megapixels');
  expect(close).toHaveBeenCalledOnce();
});
it('uses the same bounded crop for preview and encoded upload, with encoding failure recovery', async () => {
  const image = { width: 1200, height: 800 } as ImageBitmap;
  const context = { clearRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 640,
    height: 640,
    getContext: () => context,
    toBlob: vi.fn((callback: BlobCallback) => callback(null)),
  };
  drawCrop(canvas as unknown as HTMLCanvasElement, image, initialCrop);
  expect(context.drawImage).toHaveBeenLastCalledWith(
    image,
    200,
    0,
    800,
    800,
    0,
    0,
    640,
    640,
  );
  vi.stubGlobal('document', { createElement: () => canvas });
  await expect(encodeCrop(image, initialCrop)).rejects.toThrow(
    'could not be saved',
  );
  const blob = new Blob(['encoded'], { type: 'image/webp' });
  canvas.toBlob.mockImplementation((callback) => callback(blob));
  expect(await encodeCrop(image, { zoom: 2, x: 0.5, y: 0.5 })).toBe(blob);
  expect(context.drawImage).toHaveBeenLastCalledWith(
    image,
    400,
    200,
    400,
    400,
    0,
    0,
    400,
    400,
  );
  expect(canvas.width).toBe(400);
  expect(canvas.height).toBe(400);
  const large = { width: 4000, height: 3000 } as ImageBitmap;
  await encodeCrop(large, initialCrop);
  expect(canvas.width).toBe(1600);
  expect(canvas.height).toBe(1600);
  expect(context.drawImage).toHaveBeenLastCalledWith(
    large,
    500,
    0,
    3000,
    3000,
    0,
    0,
    1600,
    1600,
  );
  canvas.toBlob.mockImplementation((callback) =>
    callback(
      new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' }),
    ),
  );
  await expect(encodeCrop(large, initialCrop)).rejects.toThrow('too large');
});

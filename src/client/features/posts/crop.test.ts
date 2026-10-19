import { afterEach, expect, it, vi } from 'vitest';
import {
  adjustRectangle,
  encodePostCrop,
  fullPhoto,
  pixelRectangle,
  type CropHandle,
} from './crop';
afterEach(() => vi.unstubAllGlobals());

it('resizes freely without fixing aspect ratio and clamps movement and every edge to the photo', () => {
  const wide = adjustRectangle(fullPhoto, 's', 0, -0.5);
  expect(pixelRectangle(1200, 800, wide)).toEqual({
    x: 0,
    y: 0,
    width: 1200,
    height: 400,
  });
  const tall = adjustRectangle(fullPhoto, 'e', -0.5, 0);
  expect(pixelRectangle(1200, 800, tall)).toEqual({
    x: 0,
    y: 0,
    width: 600,
    height: 800,
  });
  expect(adjustRectangle(wide, 'move', 2, 2)).toEqual({
    left: 0,
    right: 1,
    top: 0.5,
    bottom: 1,
  });
  for (const handle of [
    'n',
    's',
    'e',
    'w',
    'nw',
    'ne',
    'sw',
    'se',
  ] as CropHandle[]) {
    for (const delta of [-10, 10]) {
      const rect = adjustRectangle(
        { left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 },
        handle,
        delta,
        delta,
      );
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(1);
      expect(rect.bottom).toBeLessThanOrEqual(1);
      expect(rect.right - rect.left).toBeGreaterThanOrEqual(0.09999);
      expect(rect.bottom - rect.top).toBeGreaterThanOrEqual(0.09999);
    }
  }
});

it('uses the selected pixels, caps the long edge, preserves aspect ratio, and retries encoding failures', async () => {
  const image = { width: 4000, height: 3000 } as ImageBitmap;
  const context = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: vi.fn((callback: BlobCallback) => callback(null)),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  const rect = { left: 0.25, right: 0.75, top: 0, bottom: 1 };
  await expect(encodePostCrop(image, rect)).rejects.toThrow(
    'Could not prepare',
  );
  expect(canvas.width).toBe(1067);
  expect(canvas.height).toBe(1600);
  expect(context.drawImage).toHaveBeenCalledWith(
    image,
    1000,
    0,
    2000,
    3000,
    0,
    0,
    1067,
    1600,
  );
  canvas.toBlob.mockImplementation((callback) =>
    callback(new Blob(['pixels'], { type: 'image/webp' })),
  );
  const file = await encodePostCrop(image, rect);
  expect(file.type).toBe('image/webp');
  expect(await file.text()).toBe('pixels');
  await encodePostCrop({ width: 500, height: 400 } as ImageBitmap, fullPhoto);
  expect([canvas.width, canvas.height]).toEqual([500, 400]);
});

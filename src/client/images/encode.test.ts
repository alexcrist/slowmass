import { afterEach, expect, it, vi } from 'vitest';
import { encodePhoto, recropSource } from './encode';

afterEach(() => vi.useRealTimers());
it('recovers when the canvas encoder never calls back and ignores late output', async () => {
  vi.useFakeTimers();
  let finish!: BlobCallback;
  const canvas = {
    toBlob: (callback: BlobCallback) => {
      finish = callback;
    },
  } as HTMLCanvasElement;
  const pending = encodePhoto(canvas);
  const failed = expect(pending).rejects.toThrow('too long to prepare');
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  finish(new Blob(['late'], { type: 'image/webp' }));
  expect(vi.getTimerCount()).toBe(0);
});

const bitmap = { width: 4096, height: 3072 } as ImageBitmap;
function stubCanvas(blob: Blob | null, context: object | null = {}) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context && { drawImage },
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { canvas, drawImage };
}

it('gives a HEIC original a full-size JPEG copy for later crops', async () => {
  const { canvas, drawImage } = stubCanvas(
    new Blob(['jpeg'], { type: 'image/jpeg' }),
  );
  const heic = new File(['heic'], 'IMG_1.HEIC', { type: 'image/heic' });
  const source = await recropSource(heic, bitmap);
  expect(source).not.toBe(heic);
  expect(source.type).toBe('image/jpeg');
  expect([canvas.width, canvas.height]).toEqual([4096, 3072]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  expect(canvas.toBlob).toHaveBeenCalledWith(
    expect.any(Function),
    'image/jpeg',
    0.95,
  );
  vi.unstubAllGlobals();
});

it('keeps other originals, and the HEIC original when no copy can be made', async () => {
  const jpeg = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
  const heic = new File(['heic'], 'photo.heic', { type: '' });
  const untouched = stubCanvas(new Blob(['jpeg'], { type: 'image/jpeg' }));
  expect(await recropSource(jpeg, bitmap)).toBe(jpeg);
  expect(untouched.canvas.toBlob).not.toHaveBeenCalled();
  stubCanvas(null);
  expect(await recropSource(heic, bitmap)).toBe(heic);
  stubCanvas(new Blob(['png'], { type: 'image/png' }));
  expect(await recropSource(heic, bitmap)).toBe(heic);
  stubCanvas(null, null);
  expect(await recropSource(heic, bitmap)).toBe(heic);
  vi.stubGlobal('document', {
    createElement: () => {
      throw new Error('no canvas');
    },
  });
  expect(await recropSource(heic, bitmap)).toBe(heic);
  vi.unstubAllGlobals();
});

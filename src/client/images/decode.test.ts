import { afterEach, expect, it, vi } from 'vitest';
import { decodePhoto } from './decode';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['image/jpeg', 'image/png', 'image/webp'])(
  'allows a %s original up to 32 MiB to reach local resizing',
  async (type) => {
    const image = { width: 8000, height: 5000, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(image);
    vi.stubGlobal('createImageBitmap', decode);
    const file = new File([new Uint8Array(32 * 1024 * 1024)], 'photo', {
      type,
    });
    expect(await decodePhoto(file)).toBe(image);
    expect(decode).toHaveBeenCalledWith(file, {
      imageOrientation: 'from-image',
    });
    expect(image.close).not.toHaveBeenCalled();
  },
);

it('reports decoding failures without returning an unprocessed original', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error()));
  await expect(
    decodePhoto(new File(['invalid'], 'photo.jpg', { type: 'image/jpeg' })),
  ).rejects.toThrow('could not be opened');
});

it('bounds a stalled decoder and closes its late bitmap', async () => {
  vi.useFakeTimers();
  let finish!: (bitmap: ImageBitmap) => void;
  const bitmap = {
    width: 1,
    height: 1,
    close: vi.fn(),
  } as unknown as ImageBitmap;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = decodePhoto(
    new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
  );
  const failed = expect(pending).rejects.toThrow('could not be opened');
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  finish(bitmap);
  await Promise.resolve();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

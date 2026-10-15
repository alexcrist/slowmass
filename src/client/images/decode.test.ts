import { afterEach, expect, it, vi } from 'vitest';
import { decodePhoto } from './decode';

afterEach(() => vi.unstubAllGlobals());

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

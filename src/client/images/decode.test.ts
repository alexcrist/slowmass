import { afterEach, expect, it, vi } from 'vitest';
import { decodePhoto } from './decode';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])(
  'opens a large %s original without a file-size limit',
  async (type) => {
    const image = { width: 4096, height: 2560, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(image);
    vi.stubGlobal('createImageBitmap', decode);
    const file = new File([new Uint8Array(40 * 1024 * 1024)], 'photo', {
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
  await vi.advanceTimersByTimeAsync(0);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

// Stands in for the decoder worker: replies to the one request it receives.
function stubHeicWorker(result: unknown) {
  const terminate = vi.fn();
  const posted: unknown[] = [];
  class StubWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminate = terminate;
    postMessage(request: unknown) {
      posted.push(request);
      if (result !== undefined)
        queueMicrotask(() => this.onmessage?.({ data: result }));
    }
  }
  vi.stubGlobal('Worker', StubWorker);
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  return { terminate, posted };
}

const heicFile = (name = 'photo.heic', type = 'image/heic') =>
  new File(['heic'], name, { type });

it.each([
  ['a HEIC type', heicFile()],
  ['an untyped .HEIC file', heicFile('IMG_0001.HEIC', '')],
  ['an untyped .heif file', heicFile('photo.heif', '')],
])(
  'decodes %s in the worker when the browser cannot open it',
  async (_, file) => {
    const bitmap = { width: 4, height: 3, close: vi.fn() };
    const native = vi
      .fn()
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce(bitmap);
    vi.stubGlobal('createImageBitmap', native);
    const worker = stubHeicWorker({
      ok: true,
      width: 4,
      height: 3,
      data: new ArrayBuffer(48),
    });
    expect(await decodePhoto(file)).toBe(bitmap);
    expect(worker.posted).toEqual([expect.any(ArrayBuffer)]);
    expect(native.mock.calls[1][0]).toMatchObject({ width: 4, height: 3 });
    expect(worker.terminate).toHaveBeenCalled();
  },
);

it('reports a HEIC the worker cannot decode', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error()));
  const worker = stubHeicWorker({ ok: false });
  await expect(decodePhoto(heicFile())).rejects.toThrow('could not be opened');
  expect(worker.terminate).toHaveBeenCalled();
});

it('stops a stalled HEIC worker at the deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error()));
  const worker = stubHeicWorker(undefined);
  const failed = expect(decodePhoto(heicFile())).rejects.toThrow(
    'could not be opened',
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  expect(worker.terminate).toHaveBeenCalled();
});

it('does not start the HEIC worker for other formats or unknown files', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error()));
  const worker = stubHeicWorker(undefined);
  await expect(
    decodePhoto(new File(['x'], 'photo.jpg', { type: 'image/jpeg' })),
  ).rejects.toThrow('could not be opened');
  await expect(
    decodePhoto(new File(['x'], 'notes.txt', { type: '' })),
  ).rejects.toThrow('JPEG, PNG, WebP, or HEIC');
  expect(worker.posted).toEqual([]);
});

it('reduces a very large original to the working size and releases it', async () => {
  const original = { width: 16384, height: 12288, close: vi.fn() };
  const smaller = { width: 4096, height: 3072, close: vi.fn() };
  const decode = vi
    .fn()
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(smaller);
  vi.stubGlobal('createImageBitmap', decode);
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  expect(await decodePhoto(file)).toBe(smaller);
  expect(decode).toHaveBeenLastCalledWith(original, {
    resizeWidth: 4096,
    resizeHeight: 3072,
    resizeQuality: 'high',
  });
  expect(original.close).toHaveBeenCalledOnce();
  expect(smaller.close).not.toHaveBeenCalled();
});

it('keeps the full-size original when the browser cannot reduce it', async () => {
  const original = { width: 3000, height: 9000, close: vi.fn() };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValueOnce(original).mockRejectedValueOnce(new Error()),
  );
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  expect(await decodePhoto(file)).toBe(original);
  expect(original.close).not.toHaveBeenCalled();
});

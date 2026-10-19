import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectContainer, MAX_PHOTO_BYTES, processPhoto } from './index';
import { readPhoto } from './storage';
afterEach(() => vi.useRealTimers());
it('rejects animation, unsupported containers, truncation and oversized input before paid processing', async () => {
  for (const name of ['oriented.jpg', 'still.png', 'still.webp'])
    expect(() =>
      inspectContainer(readFileSync(`tests/fixtures/photos/${name}`)),
    ).not.toThrow();
  for (const name of ['animated.png', 'animated.webp'])
    expect(() =>
      inspectContainer(readFileSync(`tests/fixtures/photos/${name}`)),
    ).toThrow('Animated');
  const png = readFileSync('tests/fixtures/photos/still.png');
  expect(() => inspectContainer(png.subarray(0, png.length - 1))).toThrow(
    'incomplete',
  );
  expect(() => inspectContainer(new TextEncoder().encode('<svg/>'))).toThrow(
    'still JPEG',
  );
  expect(() => inspectContainer(new Uint8Array(MAX_PHOTO_BYTES + 1))).toThrow(
    '8 MB',
  );
});
it('enforces actual streaming bytes even without a Content-Length header', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await expect(readPhoto(request)).rejects.toThrow('8 MB');
  expect(cancelled).toBe(true);
});

it('bounds an interrupted incoming body even if stream cancellation stalls', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const pending = readPhoto(
    new Request('http://localhost/upload', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit),
  );
  const failed = expect(pending).rejects.toThrow(
    'Receiving the photo took too long',
  );
  await vi.advanceTimersByTimeAsync(120_000);
  await failed;
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not continue to transform after a timed-out inspection eventually returns', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const input = vi.fn();
  const images = {
    info: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    input,
  } as unknown as ImagesBinding;
  const pending = processPhoto(
    images,
    readFileSync('tests/fixtures/photos/still.png'),
  );
  const failed = expect(pending).rejects.toThrow('processing took too long');
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  finish({ width: 10, height: 10, format: 'image/png' });
  await Promise.resolve();
  expect(input).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectContainer, MAX_PHOTO_BYTES } from './index';
import { readPhoto } from './storage';
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

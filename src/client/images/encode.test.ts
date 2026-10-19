import { afterEach, expect, it, vi } from 'vitest';
import { encodePhoto } from './encode';

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

import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { decodeHeic } from './heic-decoder';

// A synthetic 64x48 still: left half red, right half blue.
const fixture = async () =>
  new Uint8Array(
    await readFile(new URL('./fixtures/still.heic', import.meta.url)),
  );

it('decodes a HEIC still to opaque RGBA pixels', async () => {
  const image = await decodeHeic(await fixture());
  expect([image.width, image.height]).toEqual([64, 48]);
  expect(image.data.length).toBe(64 * 48 * 4);
  const pixel = (x: number, y: number) =>
    Array.from(image.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
  const [red, , blueLeft, alpha] = pixel(8, 24);
  expect(red).toBeGreaterThan(200);
  expect(blueLeft).toBeLessThan(60);
  expect(alpha).toBe(255);
  const [redRight, , blue] = pixel(56, 24);
  expect(blue).toBeGreaterThan(200);
  expect(redRight).toBeLessThan(60);
});

it('fails on bytes that are not HEIC', async () => {
  await expect(decodeHeic(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
});

import { afterEach, expect, it, vi } from 'vitest';
import { privatePhoto } from './delivery';
import { emptyMetrics, requestMetrics } from '../telemetry';

const origin = 'https://photos.example.com';
const objectKey = 'posts/immutable.webp';
function setup() {
  const match = vi.fn<Cache['match']>().mockResolvedValue(undefined);
  const put = vi.fn<Cache['put']>().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue({ match, put });
  vi.stubGlobal('caches', { open });
  const get = vi.fn().mockImplementation(async () => ({
    body: new Response('photo').body,
    size: 5,
  }));
  const env = {
    APP_ORIGIN: origin,
    PHOTOS: { get } as unknown as R2Bucket,
  };
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (work: Promise<unknown>) => pending.push(work) };
  return { env, context, pending, open, match, put, get };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('falls back to storage when cache opening or lookup fails without retaining errors', async () => {
  for (const stage of ['open', 'match'] as const) {
    const f = setup();
    f[stage].mockRejectedValue(new Error('provider details must stay private'));
    const metrics = emptyMetrics();
    const response = await requestMetrics.run(metrics, () =>
      privatePhoto(f.env, objectKey, f.context),
    );
    expect(await response?.text()).toBe('photo');
    expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
    expect(metrics).toMatchObject({
      mediaCache: 'unavailable',
      storageReads: 1,
    });
    expect(f.put).not.toHaveBeenCalled();
  }
});

it('bounds a stuck lookup and ignores a late hit while serving the storage response', async () => {
  vi.useFakeTimers();
  const f = setup();
  let release!: (response: Response) => void;
  f.match.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const metrics = emptyMetrics();
  const pending = requestMetrics.run(metrics, () =>
    privatePhoto(f.env, objectKey, f.context),
  );
  await vi.advanceTimersByTimeAsync(250);
  const response = await pending;
  expect(await response?.text()).toBe('photo');
  const late = new Response('late cached photo');
  release(late);
  await Promise.resolve();
  await Promise.resolve();
  expect(late.bodyUsed).toBe(true);
  expect(f.get).toHaveBeenCalledTimes(1);
  expect(f.put).not.toHaveBeenCalled();
  expect(metrics.mediaCache).toBe('unavailable');
});

it('streams a miss to the client even if the background cache write fails', async () => {
  const f = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.put.mockRejectedValue(new Error('secret provider details'));
  const response = await privatePhoto(f.env, objectKey, f.context);
  expect(await response?.text()).toBe('photo');
  await Promise.all(f.pending);
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ event: 'media.cache_write_failed' }),
  );
  const [key, stored] = f.put.mock.calls[0];
  if (!(key instanceof Request))
    throw new Error('Expected an internal Request');
  expect(key.url).toBe(`${origin}/media/_objects/posts%2Fimmutable.webp`);
  expect([...key.headers]).toEqual([]);
  expect(stored.headers.get('Cache-Control')).toBe('max-age=3600');
  expect(stored.headers.get('Set-Cookie')).toBeNull();
  expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
});

it('does not retain missing objects and rebuilds private headers on a cache hit', async () => {
  const f = setup();
  f.get.mockResolvedValue(null);
  expect(await privatePhoto(f.env, objectKey, f.context)).toBeNull();
  expect(f.put).not.toHaveBeenCalled();
  f.match.mockResolvedValue(
    new Response('photo', {
      headers: {
        'Content-Length': '5',
        'Cache-Control': 'max-age=3600',
        ETag: 'internal',
        'Set-Cookie': 'internal',
        'Cache-Tag': 'internal',
      },
    }),
  );
  const metrics = emptyMetrics();
  const response = await requestMetrics.run(metrics, () =>
    privatePhoto(f.env, objectKey, f.context),
  );
  expect(await response?.text()).toBe('photo');
  expect(Object.fromEntries(response!.headers)).toEqual({
    'cache-control': 'private, no-store',
    'content-length': '5',
    'content-type': 'image/webp',
    'x-content-type-options': 'nosniff',
  });
  expect(metrics).toMatchObject({ mediaCache: 'hit', storageReads: 0 });
});

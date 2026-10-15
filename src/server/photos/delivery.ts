import type { Env } from '../env';
import { measuredObjectRead, recordMediaCache } from '../telemetry';

function privateResponse(
  body: ReadableStream<Uint8Array> | null,
  size: string | null,
) {
  // Reconstruct headers: internal cache policy and metadata must never escape.
  return new Response(body, {
    headers: {
      'Content-Type': 'image/webp',
      ...(size === null ? {} : { 'Content-Length': size }),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// Call only after fresh feature authorization selects the current immutable key.
// This module caches bytes, never a session, permission decision, or HTTP route.
export async function privatePhoto(
  env: Pick<Env, 'APP_ORIGIN' | 'PHOTOS'>,
  objectKey: string,
  context: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  const key = new Request(
    new URL(`/media/_objects/${encodeURIComponent(objectKey)}`, env.APP_ORIGIN),
  );
  let cache: Cache | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const start = performance.now();
  try {
    const hit = await Promise.race([
      (async () => {
        // Named storage is separate from the default HTTP cache. No request
        // headers, cookies, conditional headers, or caller URL enter its key.
        const opened = await caches.open('slowmass-private-images-v1');
        if (expired) return undefined;
        const response = await opened.match(key);
        if (expired) {
          void response?.body?.cancel().catch(() => {});
          return undefined;
        }
        cache = opened;
        return response;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Image cache unavailable'));
        }, 250);
      }),
    ]);
    recordMediaCache(hit ? 'hit' : 'miss', performance.now() - start);
    if (hit)
      return privateResponse(hit.body, hit.headers.get('Content-Length'));
  } catch {
    cache = undefined;
    recordMediaCache('unavailable', performance.now() - start);
  } finally {
    clearTimeout(timer);
  }

  const object = await measuredObjectRead(env.PHOTOS, objectKey);
  if (!object) return null;
  const response = privateResponse(object.body, String(object.size));
  if (cache) {
    const stored = response.clone();
    stored.headers.set('Cache-Control', 'max-age=3600');
    context.waitUntil(
      cache.put(key, stored).catch(() => {
        // Do not log cache keys, private object names, or provider error text.
        console.warn(JSON.stringify({ event: 'media.cache_write_failed' }));
      }),
    );
  }
  return response;
}

import type { Env } from '../env';
import { measuredObjectRead, recordMediaCache } from '../telemetry';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

// How the member's browser may keep a response. `immutable` is only for URLs
// whose bytes never change; `revalidate` keeps bytes on the device but asks
// again, with full authorization, before every use.
export type BrowserCache = 'no-store' | 'revalidate' | 'immutable';
const browserPolicy: Record<BrowserCache, string> = {
  'no-store': 'private, no-store',
  revalidate: 'private, no-cache',
  immutable: `private, max-age=${WEEK_SECONDS}, immutable`,
};

function privateResponse(
  body: ReadableStream<Uint8Array> | null,
  size: string | null,
  browser: BrowserCache,
  etag: string | null,
  status = 200,
) {
  // Reconstruct headers: internal cache policy and metadata must never escape.
  return new Response(body, {
    status,
    headers: {
      ...(status === 200 ? { 'Content-Type': 'image/webp' } : {}),
      ...(size === null ? {} : { 'Content-Length': size }),
      'Cache-Control': browserPolicy[browser],
      ...(etag === null ? {} : { ETag: etag }),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// The validator identifies the immutable object without revealing its key.
async function entityTag(objectKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(objectKey),
  );
  return `"${Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}"`;
}

// Call only after fresh feature authorization selects the current immutable key.
// This module caches bytes, never a session, permission decision, or HTTP route.
export async function privatePhoto(
  env: Pick<Env, 'APP_ORIGIN' | 'PHOTOS'>,
  objectKey: string,
  context: Pick<ExecutionContext, 'waitUntil'>,
  request: Request,
  browser: BrowserCache,
): Promise<Response | null> {
  const etag = browser === 'no-store' ? null : await entityTag(objectKey);
  // A matching validator means the device already holds these exact bytes.
  if (
    etag !== null &&
    request.headers
      .get('If-None-Match')
      ?.split(',')
      .some((tag) => tag.trim().replace(/^W\//, '') === etag)
  ) {
    recordMediaCache('not-modified', 0);
    return privateResponse(null, null, browser, etag, 304);
  }
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
      return privateResponse(
        hit.body,
        hit.headers.get('Content-Length'),
        browser,
        etag,
      );
  } catch {
    cache = undefined;
    recordMediaCache('unavailable', performance.now() - start);
  } finally {
    clearTimeout(timer);
  }

  const object = await measuredObjectRead(env.PHOTOS, objectKey);
  if (!object) return null;
  const response = privateResponse(
    object.body,
    String(object.size),
    browser,
    etag,
  );
  if (cache) {
    const stored = response.clone();
    stored.headers.set('Cache-Control', `max-age=${WEEK_SECONDS}`);
    stored.headers.delete('ETag');
    context.waitUntil(
      cache.put(key, stored).catch(() => {
        // Do not log cache keys, private object names, or provider error text.
        console.warn(JSON.stringify({ event: 'media.cache_write_failed' }));
      }),
    );
  }
  return response;
}

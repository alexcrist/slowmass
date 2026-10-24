import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import {
  cleanupPosts,
  createDraft,
  publishPhoto,
} from '../src/server/features/posts';
import { backfillThumbnail } from '../src/server/features/posts/thumbnails';
import { cleanupAccounts, deleteAccount } from '../src/server/features/account';
import { reservePhoto } from '../src/server/photos/storage';
import type { Env } from '../src/server/env';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let env: Env;
beforeAll(async () => {
  runtime = await testRuntime(false, true);
  env = {
    DB: runtime.db,
    PHOTOS: await runtime.worker.getR2Bucket('PHOTOS'),
    IMAGES: await runtime.worker.getImagesBinding('IMAGES'),
  } as unknown as Env;
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'DELETE FROM post',
      'DELETE FROM photo_attempt',
      'DELETE FROM photo_cleanup',
      'DELETE FROM stored_object',
      'UPDATE storage_budget SET used_bytes=0,limit_bytes=8000000000',
      'DELETE FROM follow',
      'DELETE FROM block',
    ].map((sql) => runtime.db.prepare(sql)),
  );
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
});
async function upload() {
  const id = crypto.randomUUID();
  expect(
    await createDraft(env.DB, 'bob', { id, caption: '', altText: '' }),
  ).toBe('pending');
  const photo = await readFile('tests/fixtures/photos/large.png');
  // A published retry returns before reading the large body. Close this local
  // test connection so Miniflare/Undici cannot reuse its cancelled upload socket.
  const request = () =>
    runtime.request(
      'bob',
      `/api/posts/${id}/photo`,
      'PUT',
      new Blob([new Uint8Array(photo)], { type: 'image/png' }),
      { Connection: 'close' },
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, state: 'published' });
  }
  return id;
}
async function objects(id: string) {
  return (await runtime.db
    .prepare('SELECT object_key,thumbnail_key FROM post WHERE id=?')
    .bind(id)
    .first<{ object_key: string; thumbnail_key: string }>())!;
}

it('stores a smaller private grid image once, accounts for both sizes and revokes both on removal', async () => {
  const id = await upload();
  const row = await objects(id);
  expect(row.thumbnail_key).not.toBe(row.object_key);
  const full = await runtime.request('alice', `/media/posts/${id}`);
  const grid = await runtime.request('alice', `/media/posts/${id}?size=grid`);
  expect(full.status).toBe(200);
  expect(grid.status).toBe(200);
  expect(grid.headers.get('Cache-Control')).toBe(
    'private, max-age=604800, immutable',
  );
  const fullBytes = await full.arrayBuffer(),
    gridBytes = await grid.arrayBuffer();
  expect(gridBytes.byteLength).toBeLessThan(fullBytes.byteLength);
  const info = await env.IMAGES!.info(new Blob([gridBytes]).stream());
  expect(info).toMatchObject({ width: 480, height: 320, format: 'image/webp' });
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n,SUM(bytes) AS bytes FROM stored_object')
      .first(),
  ).toEqual({ n: 2, bytes: fullBytes.byteLength + gridBytes.byteLength });
  expect(
    await runtime.db
      .prepare('SELECT SUM(processing_units) AS units FROM photo_attempt')
      .first(),
  ).toEqual({ units: 2 });
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM photo_cleanup').first(),
  ).toEqual({ n: 0 });
  expect(
    (await runtime.request(null, `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  expect(
    (await runtime.request('carol', `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  expect(
    (await runtime.request('alice', `/media/posts/${id}?size=original`)).status,
  ).toBe(404);
  await runtime.request('bob', '/api/people/alice/remove', 'POST');
  expect(
    (await runtime.request('alice', `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  await runtime.request('bob', `/api/posts/${id}`, 'DELETE');
  expect(
    (await runtime.request('bob', `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  await cleanupPosts(env.DB, env.PHOTOS);
  expect(await env.PHOTOS.head(row.object_key)).toBeNull();
  expect(await env.PHOTOS.head(row.thumbnail_key)).toBeNull();
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 0 });
});

it('keeps both outputs unpublished and recoverable when the second storage write fails', async () => {
  const id = crypto.randomUUID();
  await createDraft(env.DB, 'bob', { id, caption: '', altText: '' });
  let writes = 0;
  const failingBucket = new Proxy(env.PHOTOS, {
    get(target, key) {
      if (key === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          if (++writes === 2) throw new Error('Storage unavailable');
          return Reflect.apply(target.put, target, args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    publishPhoto(
      { ...env, PHOTOS: failingBucket },
      'bob',
      id,
      new Request('http://localhost/upload', {
        method: 'PUT',
        body: new Uint8Array(await readFile('tests/fixtures/photos/large.png')),
      }),
    ),
  ).rejects.toThrow('Storage unavailable');
  expect(
    await runtime.db
      .prepare('SELECT state,object_key,thumbnail_key FROM post WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ state: 'failed', object_key: null, thumbnail_key: null });
  expect(
    (await runtime.request('bob', `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM photo_cleanup').first(),
  ).toEqual({ n: 2 });
  await runtime.db.prepare('UPDATE photo_cleanup SET not_before=0').run();
  await cleanupPosts(env.DB, env.PHOTOS);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 0 });
});

it('backfills legacy photos once without changing their publication time or bypassing quota', async () => {
  const id = await upload();
  const row = await objects(id);
  const before = await runtime.db
    .prepare('SELECT published_at FROM post WHERE id=?')
    .bind(id)
    .first();
  await runtime.db
    .prepare('UPDATE post SET thumbnail_key=NULL WHERE id=?')
    .bind(id)
    .run();
  const fallback = await runtime.request(
    'alice',
    `/media/posts/${id}?size=grid`,
  );
  expect(Number(fallback.headers.get('Content-Length'))).toBe(
    (await env.PHOTOS.head(row.object_key))!.size,
  );
  await Promise.all([backfillThumbnail(env), backfillThumbnail(env)]);
  const after = await objects(id);
  expect(after.thumbnail_key).not.toBeNull();
  expect(after.thumbnail_key).not.toBe(row.thumbnail_key);
  await backfillThumbnail(env);
  expect(await objects(id)).toEqual(after);
  expect(
    await runtime.db
      .prepare('SELECT published_at FROM post WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual(before);
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM photo_attempt WHERE id LIKE '%:thumbnail/%'",
      )
      .first(),
  ).toEqual({ n: 1 });
});

it('reserves transformation units atomically at the monthly ceiling', async () => {
  // Old attempts are outside the daily cap but within the current UTC month.
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 15));
  try {
    const month = Date.UTC(2026, 9, 1);
    await runtime.db
      .prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1749)
    INSERT INTO photo_attempt(id,user_id,created_at,state,processing_units) SELECT 'old-'||n,'bob',?,'done',2 FROM seq`,
      )
      .bind(month)
      .run();
    const results = await Promise.all([
      reservePhoto(env.DB, 'alice', 'budget-a', 2),
      reservePhoto(env.DB, 'carol', 'budget-c', 2),
    ]);
    expect(results.filter((r) => r === 'reserved')).toHaveLength(1);
    expect(
      (await runtime.db
        .prepare('SELECT SUM(processing_units) AS n FROM photo_attempt')
        .first<{ n: number }>())!.n,
    ).toBeLessThanOrEqual(3500);
  } finally {
    now.mockRestore();
  }
});

it('queues both variants when deleting an account', async () => {
  const id = await upload();
  const row = await objects(id);
  await deleteAccount(env.DB, 'bob');
  expect(
    (await runtime.request('alice', `/media/posts/${id}?size=grid`)).status,
  ).toBe(404);
  await cleanupAccounts(env.DB);
  for (const key of [row.object_key, row.thumbnail_key])
    expect(
      await runtime.db
        .prepare('SELECT 1 FROM photo_cleanup WHERE object_key=?')
        .bind(key)
        .first(),
    ).not.toBeNull();
});

import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let bucket: Awaited<ReturnType<typeof runtime.worker.getR2Bucket>>;
let cache: Awaited<
  ReturnType<Awaited<ReturnType<typeof runtime.worker.getCaches>>['open']>
>;
let postId: string;
let keys: string[];
const cacheUrl = (key: string) =>
  `http://localhost:8787/media/_objects/${encodeURIComponent(key)}`;
const variants = () => [
  `/media/posts/${postId}`,
  `/media/posts/${postId}?size=grid`,
  '/media/avatar/bob',
  '/media/avatar/bob?size=large',
];
async function restoreSession(id: string) {
  const now = Date.now();
  await runtime.db
    .prepare(
      'INSERT OR REPLACE INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      id,
      id,
      `${id}-token`,
      new Date(now + 86400000).toISOString(),
      now,
      now,
    )
    .run();
}
beforeAll(async () => {
  runtime = await testRuntime();
  bucket = await runtime.worker.getR2Bucket('PHOTOS');
  cache = await (
    await runtime.worker.getCaches()
  ).open('slowmass-private-images-v1');
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => runtime?.worker.dispose());
beforeEach(async () => {
  await restoreSession('alice');
  await runtime.db.batch(
    [
      'DELETE FROM post',
      'DELETE FROM follow',
      'DELETE FROM block',
      "UPDATE membership SET status='active'",
      `UPDATE session SET expiresAt='${new Date(Date.now() + 86400000).toISOString()}'`,
    ].map((sql) => runtime.db.prepare(sql)),
  );
  postId = crypto.randomUUID();
  keys = ['post', 'grid', 'avatar', 'large'].map(
    (variant) => `${variant}/${postId}.webp`,
  );
  await runtime.db
    .prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,thumbnail_key,width,height) VALUES(?,'bob','','',1,1,'published',?,?,1,1)",
    )
    .bind(postId, keys[0], keys[1])
    .run();
  await runtime.db
    .prepare("UPDATE avatar SET object_key=?,large_key=? WHERE user_id='bob'")
    .bind(keys[2], keys[3])
    .run();
  for (const key of keys) await bucket.put(key, `synthetic ${key}`);
  expect(
    (await runtime.request('alice', '/api/people/bob/request', 'POST')).status,
  ).toBe(200);
  expect(
    (await runtime.request('bob', '/api/people/alice/accept', 'POST')).status,
  ).toBe(200);
});
async function warm() {
  for (const [index, path] of variants().entries()) {
    const response = await runtime.request('alice', path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Server-Timing')).toContain('desc="miss"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe(`synthetic ${keys[index]}`);
    await expect
      .poll(async () => !!(await cache.match(cacheUrl(keys[index]))))
      .toBe(true);
  }
}
async function denied(actor: string | null, paths = variants()) {
  for (const path of paths) {
    const response = await runtime.request(actor, path, 'GET', undefined, {
      'If-None-Match': '*',
      'If-Modified-Since': new Date().toUTCString(),
      Range: 'bytes=0-2',
    });
    expect(response.status, path).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Server-Timing')).not.toContain('media-cache');
    expect(await response.text()).not.toContain('synthetic');
  }
}
it('reuses each immutable variant across authorized viewers while cache keys have no public route', async () => {
  await warm();
  // Removing R2 objects in this synthetic fixture proves warm reads use bytes
  // from the real Workers cache rather than another object-store request.
  for (const key of keys) await bucket.delete(key);
  for (const actor of ['alice', 'bob']) {
    for (const [index, path] of variants().entries()) {
      const response = await runtime.request(actor, path, 'GET', undefined, {
        Range: 'bytes=0-2',
        'If-None-Match': '*',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Server-Timing')).toContain('desc="hit"');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('ETag')).toBeNull();
      expect(await response.text()).toBe(`synthetic ${keys[index]}`);
    }
  }
  const defaults = (await runtime.worker.getCaches()).default;
  for (const key of keys) {
    expect(await defaults.match(cacheUrl(key))).toBeUndefined();
    await denied(null, [new URL(cacheUrl(key)).pathname]);
    await denied('bob', [new URL(cacheUrl(key)).pathname]);
  }
  // An evicted entry is a miss, including an absent backing object. Neither
  // absence nor a later newly available object is negatively cached.
  await cache.delete(cacheUrl(keys[0]));
  expect((await runtime.request('alice', variants()[0])).status).toBe(404);
  await bucket.put(keys[0], `synthetic ${keys[0]}`);
  const restored = await runtime.request('alice', variants()[0]);
  expect(restored.status).toBe(200);
  expect(restored.headers.get('Server-Timing')).toContain('desc="miss"');
  expect(await restored.text()).toBe(`synthetic ${keys[0]}`);
});

it('checks signed-out, expired, pending, removed, blocked and inactive access before warm lookups', async () => {
  await warm();
  await denied(null);
  await denied('carol', variants().slice(0, 2));
  expect(
    (await runtime.request('carol', '/api/people/bob/request', 'POST')).status,
  ).toBe(200);
  await denied('carol', variants().slice(0, 2));
  await runtime.db
    .prepare(
      "UPDATE session SET expiresAt='2020-01-01T00:00:00.000Z' WHERE userId='alice'",
    )
    .run();
  await denied('alice');
  await restoreSession('alice');
  const renewed = await runtime.request('alice', variants()[0]);
  expect(renewed.headers.get('Server-Timing')).toContain('desc="hit"');
  await renewed.arrayBuffer();
  for (const member of ['alice', 'bob']) {
    await runtime.db
      .prepare("UPDATE membership SET status='disabled' WHERE user_id=?")
      .bind(member)
      .run();
    await denied('alice');
    await runtime.db
      .prepare("UPDATE membership SET status='active' WHERE user_id=?")
      .bind(member)
      .run();
  }
  expect(
    (await runtime.request('bob', '/api/people/alice/remove', 'POST')).status,
  ).toBe(200);
  await denied('alice', variants().slice(0, 2));
  // Removing a follow must not accidentally hide avatars, which are visible
  // to every active unblocked member.
  for (const path of variants().slice(2)) {
    const avatar = await runtime.request('alice', path);
    expect(avatar.headers.get('Server-Timing')).toContain('desc="hit"');
    await avatar.arrayBuffer();
  }
  for (const [blocker, blocked] of [
    ['alice', 'bob'],
    ['bob', 'alice'],
  ]) {
    await runtime.db
      .prepare('INSERT INTO block VALUES(?,?,0)')
      .bind(blocker, blocked)
      .run();
    await denied('alice');
    await runtime.db.prepare('DELETE FROM block').run();
  }
  expect(
    (await runtime.request('alice', '/api/auth/sign-out', 'POST', {})).status,
  ).toBe(200);
  await denied('alice');
});

it('selects replacement avatar keys immediately and rejects cached bytes after post or account deletion', async () => {
  await warm();
  const replaced = keys.slice(2).map((key) => `new-${key}`);
  for (const key of replaced) await bucket.put(key, `replacement ${key}`);
  await runtime.db
    .prepare("UPDATE avatar SET object_key=?,large_key=? WHERE user_id='bob'")
    .bind(...replaced)
    .run();
  for (const [index, path] of variants().slice(2).entries()) {
    const response = await runtime.request('alice', path);
    expect(response.headers.get('Server-Timing')).toContain('desc="miss"');
    expect(await response.text()).toBe(`replacement ${replaced[index]}`);
    await expect
      .poll(async () => !!(await cache.match(cacheUrl(replaced[index]))))
      .toBe(true);
  }
  expect(
    (await runtime.request('bob', `/api/posts/${postId}`, 'DELETE')).status,
  ).toBe(200);
  await denied('alice', variants().slice(0, 2));
  expect(
    (
      await runtime.request('bob', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  await denied('alice');
  // Old bytes still exist internally, proving denial doesn't depend on purge.
  for (const key of [...keys, ...replaced])
    expect(await cache.match(cacheUrl(key))).toBeDefined();
});

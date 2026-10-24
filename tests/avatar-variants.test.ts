import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testRuntime } from './support/runtime';
import { saveAvatar } from '../src/server/features/avatars';
import { cleanupAvatars } from '../src/server/features/avatars/cleanup';
import { cleanupAccounts, deleteAccount } from '../src/server/features/account';
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
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'DELETE FROM avatar',
      'DELETE FROM photo_attempt',
      'DELETE FROM photo_cleanup',
      'DELETE FROM stored_object',
      'DELETE FROM block',
      'UPDATE storage_budget SET used_bytes=0,limit_bytes=8000000000',
    ].map((sql) => runtime.db.prepare(sql)),
  );
});
afterAll(async () => runtime?.worker.dispose());
async function upload(file = 'large.png', id = crypto.randomUUID()) {
  return runtime.request(
    'alice',
    '/api/avatar',
    'PUT',
    new Blob(
      [new Uint8Array(await readFile(`tests/fixtures/photos/${file}`))],
      { type: 'image/png' },
    ),
    {
      'Idempotency-Key': id,
      'Content-Type': 'image/png',
      Connection: 'close',
    },
  );
}
async function current() {
  return (await runtime.db
    .prepare("SELECT object_key,large_key FROM avatar WHERE user_id='alice'")
    .first<{ object_key: string; large_key: string | null }>())!;
}
async function uploadRequest() {
  return new Request('http://localhost/upload', {
    method: 'PUT',
    body: new Uint8Array(await readFile('tests/fixtures/photos/large.png')),
  });
}

it('stores two private sizes once, meters both, and checks blocks in both directions', async () => {
  const id = crypto.randomUUID();
  expect((await upload('large.png', id)).status).toBe(200);
  expect((await upload('large.png', id)).status).toBe(200);
  const row = await current();
  expect(row.large_key).not.toBe(row.object_key);
  const bytes: ArrayBuffer[] = [];
  // A follow is not required to see either avatar size.
  for (const suffix of ['', '?size=large']) {
    const response = await runtime.request(
      'bob',
      '/media/avatar/alice' + suffix,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
    bytes.push(await response.arrayBuffer());
    expect(
      (await runtime.request(null, '/media/avatar/alice' + suffix)).status,
    ).toBe(404);
  }
  expect(await env.IMAGES!.info(new Blob([bytes[0]]).stream())).toMatchObject({
    width: 320,
    height: 213,
  });
  expect(await env.IMAGES!.info(new Blob([bytes[1]]).stream())).toMatchObject({
    width: 1200,
    height: 800,
  });
  expect(bytes[0].byteLength).toBeLessThan(bytes[1].byteLength);
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n,SUM(bytes) AS bytes FROM stored_object')
      .first(),
  ).toEqual({ n: 2, bytes: bytes[0].byteLength + bytes[1].byteLength });
  expect(
    await runtime.db
      .prepare(
        'SELECT COUNT(*) AS n,SUM(processing_units) AS units FROM photo_attempt',
      )
      .first(),
  ).toEqual({ n: 1, units: 2 });
  expect(
    (await runtime.request('bob', '/media/avatar/alice?size=original')).status,
  ).toBe(404);
  for (const [blocker, target] of [
    ['alice', 'bob'],
    ['bob', 'alice'],
  ]) {
    await runtime.db
      .prepare('INSERT INTO block VALUES(?,?,0)')
      .bind(blocker, target)
      .run();
    for (const suffix of ['', '?size=large'])
      expect(
        (await runtime.request('bob', '/media/avatar/alice' + suffix)).status,
      ).toBe(404);
    await runtime.db.prepare('DELETE FROM block').run();
  }
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  for (const suffix of ['', '?size=large'])
    expect(
      (await runtime.request('bob', '/media/avatar/alice' + suffix)).status,
    ).toBe(404);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();
});

it('reuses small images without upscaling and serves existing photos without backfill', async () => {
  expect((await upload('still.png')).status).toBe(200);
  const row = await current();
  expect(row.large_key).toBe(row.object_key);
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM stored_object').first(),
  ).toEqual({ n: 1 });
  await runtime.db
    .prepare("UPDATE avatar SET large_key=NULL WHERE user_id='alice'")
    .run();
  const large = await runtime.request('bob', '/media/avatar/alice?size=large');
  const small = await runtime.request('bob', '/media/avatar/alice');
  expect(large.status).toBe(200);
  expect(await large.arrayBuffer()).toEqual(await small.arrayBuffer());
});

it('replaces both sizes together, cleans up prior objects and protects current references', async () => {
  expect((await upload()).status).toBe(200);
  const before = await current();
  expect((await upload()).status).toBe(200);
  const after = await current();
  expect(after.object_key).not.toBe(before.object_key);
  expect(after.large_key).not.toBe(before.large_key);
  await cleanupAvatars(env.DB, env.PHOTOS);
  for (const key of [before.object_key, before.large_key!])
    expect(await env.PHOTOS.head(key)).toBeNull();
  for (const key of [after.object_key, after.large_key!]) {
    expect(await env.PHOTOS.head(key)).not.toBeNull();
    await runtime.db
      .prepare('INSERT INTO photo_cleanup VALUES(?,0)')
      .bind(key)
      .run();
  }
  await cleanupAvatars(env.DB, env.PHOTOS);
  for (const key of [after.object_key, after.large_key!])
    expect(await env.PHOTOS.head(key)).not.toBeNull();
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM stored_object').first(),
  ).toEqual({ n: 2 });
});

it('retains the current avatar if writing the second size fails and reclaims partial uploads', async () => {
  expect((await upload()).status).toBe(200);
  const before = await current();
  const budget = await runtime.db
    .prepare('SELECT used_bytes FROM storage_budget')
    .first();
  let writes = 0;
  const bucket = new Proxy(env.PHOTOS, {
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
  const id = crypto.randomUUID();
  await expect(
    saveAvatar({ ...env, PHOTOS: bucket }, 'alice', id, await uploadRequest()),
  ).rejects.toThrow('Storage unavailable');
  expect(await current()).toEqual(before);
  expect((await upload('large.png', id)).status).toBe(409);
  expect(
    await runtime.db
      .prepare('SELECT state FROM photo_attempt WHERE id=?')
      .bind(`alice:${id}`)
      .first(),
  ).toEqual({ state: 'failed' });
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM photo_cleanup').first(),
  ).toEqual({ n: 2 });
  await runtime.db.prepare('UPDATE photo_cleanup SET not_before=0').run();
  await cleanupAvatars(env.DB, env.PHOTOS);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual(budget);
});

it('cannot publish during account deletion and erases both current and unreferenced sizes', async () => {
  expect((await upload()).status).toBe(200);
  let writes = 0;
  const bucket = new Proxy(env.PHOTOS, {
    get(target, key) {
      if (key === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          const result = await Reflect.apply(target.put, target, args);
          if (++writes === 2) await deleteAccount(env.DB, 'alice');
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect(
    await saveAvatar(
      { ...env, PHOTOS: bucket },
      'alice',
      crypto.randomUUID(),
      await uploadRequest(),
    ),
  ).toBe('inactive');
  for (const suffix of ['', '?size=large'])
    expect(
      (await runtime.request('bob', '/media/avatar/alice' + suffix)).status,
    ).toBe(404);
  await cleanupAccounts(env.DB);
  const rows = await runtime.db
    .prepare('SELECT object_key FROM stored_object')
    .all<{ object_key: string }>();
  expect(rows.results).toHaveLength(4);
  await runtime.db.prepare('UPDATE photo_cleanup SET not_before=0').run();
  await cleanupAvatars(env.DB, env.PHOTOS);
  await cleanupAvatars(env.DB, env.PHOTOS);
  for (const row of rows.results)
    expect(await env.PHOTOS.head(row.object_key)).toBeNull();
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 0 });
});

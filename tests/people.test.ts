import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { reservePhoto } from '../src/server/photos/storage';
import { cleanupAvatars } from '../src/server/features/avatars/cleanup';
import { testRuntime } from './support/runtime';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'DELETE FROM avatar',
      'DELETE FROM photo_cleanup',
      'DELETE FROM photo_attempt',
      'DELETE FROM follow',
      'DELETE FROM block',
      'DELETE FROM profile',
    ].map((sql) => runtime.db.prepare(sql)),
  );
  for (const id of ['alice', 'bob', 'carol']) {
    expect(
      (
        await runtime.request(id, '/api/people/self', 'PUT', {
          handle: id,
          displayName: id,
          bio: `Private bio for ${id}`,
        })
      ).status,
    ).toBe(200);
  }
});
const action = (actor: string, target: string, command: string) =>
  runtime.request(actor, `/api/people/${target}/${command}`, 'POST');
const read = async (actor: string, target: string) =>
  (await runtime.request(actor, `/api/people/${target}`)).json() as Promise<{
    profile: { bio: string | null; relationship: string };
  }>;
it('requires a session and preserves private bios until the owner accepts', async () => {
  expect((await runtime.request(null, '/api/people/bob')).status).toBe(401);
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  expect((await action('alice', 'bob', 'request')).status).toBe(200);
  expect((await action('alice', 'bob', 'request')).status).toBe(200);
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: null,
    relationship: 'pending',
  });
  await action('carol', 'alice', 'accept'); // A third party cannot accept Bob's request.
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  const pending = await (
    await runtime.request('bob', '/api/people/connections?kind=requests')
  ).json();
  expect(pending).toEqual({
    items: [{ handle: 'alice', displayName: 'alice' }],
    next: null,
  });
  await action('bob', 'alice', 'accept');
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: 'Private bio for bob',
    relationship: 'accepted',
  });
  expect((await read('carol', 'bob')).profile.bio).toBeNull();
  expect((await read('bob', 'alice')).profile.bio).toBeNull(); // follows are directional
  await action('bob', 'alice', 'remove');
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: null,
    relationship: 'none',
  });
});
it('handles crossing requests, blocking in both directions, and unblock without restoration', async () => {
  await Promise.all([
    action('alice', 'bob', 'request'),
    action('bob', 'alice', 'request'),
  ]);
  await Promise.all([
    action('alice', 'bob', 'accept'),
    action('bob', 'alice', 'accept'),
  ]);
  expect((await read('alice', 'bob')).profile.relationship).toBe('accepted');
  expect((await read('bob', 'alice')).profile.relationship).toBe('accepted');
  await Promise.all([
    action('alice', 'bob', 'block'),
    action('bob', 'alice', 'request'),
  ]);
  expect((await runtime.request('bob', '/api/people/alice')).status).toBe(404);
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  expect((await action('bob', 'alice', 'request')).status).toBe(404);
  expect(await runtime.db.prepare('SELECT 1 FROM follow').first()).toBeNull();
  expect(
    await (
      await runtime.request('alice', '/api/people/connections?kind=blocked')
    ).json(),
  ).toEqual({ items: [{ handle: 'bob', displayName: 'bob' }], next: null });
  await action('alice', 'bob', 'unblock');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  expect((await read('bob', 'alice')).profile.relationship).toBe('none');
});
it('supports cancel, deny, and unfollow without changing another relationship', async () => {
  await action('alice', 'bob', 'request');
  await action('alice', 'bob', 'cancel');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'deny');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  await action('bob', 'alice', 'deny'); // Stale deny must not remove an accepted follower.
  expect((await read('alice', 'bob')).profile.relationship).toBe('accepted');
  await action('alice', 'bob', 'unfollow');
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  expect((await action('alice', 'alice', 'request')).status).toBe(409);
});
it('validates and reserves unique immutable handles, while allowing profile edits', async () => {
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'a',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'ALICE',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'david',
        displayName: 'D',
        bio: 'hello',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'new_handle',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'david',
        displayName: 'Updated',
        bio: 'changed',
        hasAvatar: 0,
      })
    ).status,
  ).toBe(200);
  expect(
    await (await runtime.request('david', '/api/people/self')).json(),
  ).toEqual({
    profile: {
      handle: 'david',
      displayName: 'Updated',
      bio: 'changed',
      hasAvatar: 0,
    },
  });
});
it('does not grant access when an account is disabled', async () => {
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  expect((await runtime.request('bob', '/api/people/self')).status).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='bob'")
    .run();
});
it('validates pagination and scopes lists to the signed-in account', async () => {
  await action('alice', 'bob', 'request');
  expect(
    await (
      await runtime.request('carol', '/api/people/connections?kind=requests')
    ).json(),
  ).toEqual({ items: [], next: null });
  expect(
    (await runtime.request('bob', '/api/people/connections?kind=all')).status,
  ).toBe(400);
  expect(
    (await runtime.request('bob', '/api/people/connections?after=%27')).status,
  ).toBe(400);
});
it('authorizes avatar bytes on every request, including saved URLs after removal', async () => {
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put('avatar-test', 'synthetic image bytes');
  await runtime.db
    .prepare(
      'INSERT INTO avatar (user_id,object_key,width,height) VALUES (?,?,1,1)',
    )
    .bind('bob', 'avatar-test')
    .run();
  const path = '/media/avatar/bob';
  expect((await runtime.request(null, path)).status).toBe(404);
  expect((await runtime.request('carol', path)).status).toBe(404);
  expect((await runtime.request('bob', path)).status).toBe(200);
  await action('alice', 'bob', 'request');
  expect((await runtime.request('alice', path)).status).toBe(404);
  await action('bob', 'alice', 'accept');
  const visible = await runtime.request('alice', path);
  expect(visible.status).toBe(200);
  expect(visible.headers.get('cache-control')).toBe('private, no-store');
  await action('bob', 'alice', 'remove');
  expect((await runtime.request('alice', path)).status).toBe(404);
  await runtime.request('bob', '/api/avatar', 'DELETE');
  expect((await runtime.request('bob', path)).status).toBe(404);
  expect(
    await runtime.db.prepare('SELECT object_key FROM photo_cleanup').first(),
  ).toMatchObject({ object_key: 'avatar-test' });
});

it('bounds processing attempts, deduplicates retries and cleans orphaned objects', async () => {
  const db = runtime.db as unknown as D1Database;
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  for (let i = 0; i < 5; i++)
    expect(await reservePhoto(db, 'alice', String(i))).toBe('reserved');
  expect(await reservePhoto(db, 'alice', '0')).toBe('pending');
  expect(await reservePhoto(db, 'alice', '6')).toBe('quota');
  expect(await reservePhoto(db, 'bob', '0')).toBe('reserved');
  await runtime.db
    .prepare("UPDATE photo_attempt SET state='done' WHERE id='alice:0'")
    .run();
  expect(await reservePhoto(db, 'alice', '0')).toBe('done');
  await bucket.put('orphan', 'orphan bytes');
  await bucket.put('current', 'current bytes');
  await runtime.db
    .prepare(
      'INSERT INTO avatar(user_id,object_key,width,height) VALUES(?,?,1,1)',
    )
    .bind('bob', 'current')
    .run();
  for (const key of ['orphan', 'current'])
    await runtime.db
      .prepare('INSERT INTO photo_cleanup(object_key,not_before) VALUES(?,0)')
      .bind(key)
      .run();
  await cleanupAvatars(db, bucket as unknown as R2Bucket);
  expect(await bucket.get('orphan')).toBeNull();
  expect(await bucket.get('current')).not.toBeNull();
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM photo_cleanup WHERE object_key='orphan'")
      .first(),
  ).toBeNull();
});

it('allows a reciprocal block while lookup is hidden', async () => {
  await action('alice', 'bob', 'block');
  await action('bob', 'alice', 'block');
  await action('alice', 'bob', 'unblock');
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  await action('bob', 'alice', 'unblock');
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(200);
});

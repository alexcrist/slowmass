import { beforeAll, afterAll, it, expect } from 'vitest';
import { testRuntime } from './support/runtime';
import { reserveStorage, releaseStorage } from '../src/server/photos/storage';
import { deleteAccount, cleanupAccounts } from '../src/server/features/account';
import { cleanupPosts } from '../src/server/features/posts';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: 'Private bio',
    });
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
it('reserves bytes atomically across concurrent uploads and releases only once', async () => {
  const db = runtime.db as unknown as D1Database;
  await runtime.db.prepare('UPDATE storage_budget SET limit_bytes=100').run();
  const results = await Promise.allSettled([
    reserveStorage(db, 'bob', 'posts/a', 60),
    reserveStorage(db, 'bob', 'posts/b', 60),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 60 });
  const row = await runtime.db
    .prepare('SELECT object_key FROM stored_object')
    .first<{ object_key: string }>();
  await Promise.all([
    releaseStorage(db, row!.object_key),
    releaseStorage(db, row!.object_key),
  ]);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 0 });
  await runtime.db
    .prepare('UPDATE storage_budget SET limit_bytes=8000000000')
    .run();
});
it('retains quota for stored bytes until deletion succeeds, and enforces member limits', async () => {
  const db = runtime.db as unknown as D1Database,
    bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await runtime.db.batch([
    runtime.db.prepare(
      "INSERT INTO stored_object VALUES('posts/existing','bob',249999990,0)",
    ),
    runtime.db.prepare('UPDATE storage_budget SET used_bytes=249999990'),
  ]);
  await expect(reserveStorage(db, 'bob', 'posts/over', 11)).rejects.toThrow(
    'storage limit',
  );
  await reserveStorage(db, 'bob', 'posts/small', 10);
  await bucket.put('posts/small', '0123456789');
  await runtime.db
    .prepare(
      "UPDATE photo_cleanup SET not_before=0 WHERE object_key='posts/small'",
    )
    .run();
  const failing = {
    delete: async () => {
      throw new Error('Storage unavailable');
    },
  } as unknown as R2Bucket;
  await cleanupPosts(db, failing);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 250000000 });
  await cleanupPosts(db, bucket as unknown as R2Bucket);
  expect(
    await runtime.db.prepare('SELECT used_bytes FROM storage_budget').first(),
  ).toEqual({ used_bytes: 249999990 });
  await releaseStorage(db, 'posts/existing');
  await runtime.db.prepare('DELETE FROM photo_cleanup').run();
});
it('deletes an account without deleting invitation ancestry, revokes access immediately and scrubs content in bounded passes', async () => {
  const db = runtime.db as unknown as D1Database;
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
  for (let i = 0; i < 7; i++)
    await runtime.db
      .prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,'bob','Secret','Secret',1,1,'published',?,1,1)",
      )
      .bind(`bob-${i}`, `posts/bob-${i}`)
      .run();
  const provenance = await runtime.db
    .prepare(
      "SELECT invited_by,invitation_id,joined_at FROM membership WHERE user_id='bob'",
    )
    .first();
  const issued = await runtime.db
    .prepare("SELECT inviter_id,created_at FROM invitation WHERE id='bob'")
    .first();
  expect(
    (
      await runtime.request('bob', '/api/me', 'DELETE', {
        confirmation: 'wrong',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await runtime.request('bob', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  expect((await runtime.request('bob', '/api/me')).status).toBe(401);
  expect((await runtime.request('alice', '/api/posts/bob-0')).status).toBe(404);
  expect((await runtime.request('alice', '/media/posts/bob-0')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  await expect(reserveStorage(db, 'bob', 'posts/late', 1)).rejects.toThrow();
  await deleteAccount(db, 'bob');
  await cleanupAccounts(db);
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM post WHERE user_id='bob' AND state!='deleted'",
      )
      .first(),
  ).toEqual({ n: 2 });
  await cleanupAccounts(db);
  expect(
    await runtime.db
      .prepare(
        "SELECT invited_by,invitation_id,joined_at FROM membership WHERE user_id='bob'",
      )
      .first(),
  ).toEqual(provenance);
  expect(
    await runtime.db
      .prepare("SELECT inviter_id,created_at FROM invitation WHERE id='bob'")
      .first(),
  ).toEqual(issued);
  expect(
    await runtime.db
      .prepare("SELECT recipient_email FROM invitation WHERE id='bob'")
      .first(),
  ).toEqual({ recipient_email: 'deleted:bob' });
  expect(
    await runtime.db
      .prepare(
        "SELECT email_to_redact,completed_at FROM account_deletion WHERE user_id='bob'",
      )
      .first(),
  ).toMatchObject({ email_to_redact: null, completed_at: expect.any(Number) });
  await expect(
    runtime.db
      .prepare("UPDATE invitation SET created_at=0 WHERE id='bob'")
      .run(),
  ).rejects.toThrow('immutable');
  await expect(
    runtime.db
      .prepare(
        "UPDATE invitation SET recipient_email='changed@example.com' WHERE id='carol'",
      )
      .run(),
  ).rejects.toThrow('immutable');
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM photo_cleanup').first(),
  ).toEqual({ n: 7 });
});

it('fails closed during maintenance before API or media access', async () => {
  const paused = await testRuntime(true);
  try {
    for (const path of ['/api/me', '/api/posts', '/media/posts/synthetic'])
      expect((await paused.request('alice', path)).status).toBe(503);
    expect(
      (
        await paused.request('alice', '/api/me', 'DELETE', {
          confirmation: 'DELETE',
        })
      ).status,
    ).toBe(503);
    expect(
      await paused.db
        .prepare("SELECT status FROM membership WHERE user_id='alice'")
        .first(),
    ).toEqual({ status: 'active' });
  } finally {
    await paused.worker.dispose();
  }
});

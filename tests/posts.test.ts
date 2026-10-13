import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import {
  createDraft,
  publishPhoto,
  cleanupPosts,
  listPosts,
  editCaption,
} from '../src/server/features/posts';
import {
  measuredDatabase,
  requestMetrics,
  emptyMetrics,
} from '../src/server/telemetry';
import type { Env } from '../src/server/env';
import { reservePhoto } from '../src/server/photos/storage';
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
      'DELETE FROM post',
      'DELETE FROM photo_attempt',
      'DELETE FROM photo_cleanup',
      'DELETE FROM follow',
      'DELETE FROM block',
      'DELETE FROM profile',
    ].map((sql) => runtime.db.prepare(sql)),
  );
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: `Private ${id}`,
    });
  await seedProfilePhotos(runtime.db);
  await runtime.db.prepare('DELETE FROM follow').run(); // Independent users for permission tests.
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
});
async function seed(
  id: string,
  owner: string,
  time: number,
  state = 'published',
) {
  await runtime.db
    .prepare(
      'INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,?,?,?,?,?,?,?,1,1)',
    )
    .bind(
      id,
      owner,
      `Caption ${id}`,
      'Alt text',
      time,
      time,
      state,
      `posts/${id}.webp`,
    )
    .run();
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`posts/${id}.webp`, 'synthetic output');
}
type Feed = { items: { id: string }[]; next: string | null };
async function feed(cursor?: string) {
  return (
    await runtime.request(
      'alice',
      `/api/posts${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
    )
  ).json() as Promise<Feed>;
}
it('paginates own and followed posts chronologically without duplicates across inserts and deletions', async () => {
  for (let i = 0; i < 27; i++)
    await seed(`bob-${String(i).padStart(2, '0')}`, 'bob', 1000 + i);
  await seed('own', 'alice', 3000);
  await seed('stranger', 'carol', 5000);
  const first = await feed();
  expect(first.items).toHaveLength(12);
  expect(first.items[0]).toMatchObject({ id: 'own', isOwner: true });
  expect(first.items[1]).toMatchObject({ id: 'bob-26', isOwner: false });
  expect(first.items.some((p) => p.id === 'stranger')).toBe(false);
  await seed('later', 'bob', 6000);
  await seed('later-own', 'alice', 7000);
  await runtime.request('bob', '/api/posts/bob-14', 'DELETE');
  const second = await feed(first.next!);
  expect(second.items[0].id).toBe('bob-15');
  const third = await feed(second.next!);
  expect(third.next).toBeNull();
  const ids = [...first.items, ...second.items, ...third.items].map(
    (p) => p.id,
  );
  expect(ids).toHaveLength(27);
  expect(new Set(ids).size).toBe(27);
  expect(ids).not.toContain('later');
  expect(ids).not.toContain('later-own');
  expect(ids).not.toContain('bob-14');
  expect((await feed()).items.slice(0, 2).map((p) => p.id)).toEqual([
    'later-own',
    'later',
  ]);
});
it('uses the ID tiebreaker for existing posts with identical timestamps', async () => {
  for (let i = 0; i < 14; i++)
    await seed(
      `same-${String(i).padStart(2, '0')}`,
      i % 2 ? 'alice' : 'bob',
      1000,
    );
  const first = await feed();
  const second = await feed(first.next!);
  expect([...first.items, ...second.items].map((p) => p.id)).toEqual(
    Array.from(
      { length: 14 },
      (_, i) => `same-${String(13 - i).padStart(2, '0')}`,
    ),
  );
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(
    14,
  );
});
it('merges uneven author histories and tied timestamps across pages', async () => {
  await runtime.request('alice', '/api/people/carol/request', 'POST');
  await runtime.request('carol', '/api/people/alice/accept', 'POST');
  const expected: { id: string; time: number }[] = [];
  for (let i = 0; i < 43; i++) {
    const owner = i % 5 === 0 ? 'alice' : i % 9 === 0 ? 'carol' : 'bob';
    const id = `${owner}-${String(i).padStart(2, '0')}`;
    const time = 1000 + Math.floor(i / 3);
    await seed(id, owner, time);
    expected.push({ id, time });
  }
  await seed('own-draft', 'alice', 9000, 'pending');
  await seed('draft', 'bob', 9001, 'pending');
  expected.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await feed(cursor);
    ids.push(...page.items.map((p) => p.id));
    cursor = page.next ?? undefined;
  } while (cursor);
  expect(ids).toEqual(expected.map((p) => p.id));
});
it('shows only published own posts with no follows and removes deleted posts from older pages', async () => {
  await runtime.request('alice', '/api/people/bob/unfollow', 'POST');
  for (let i = 0; i < 14; i++)
    await seed(`own-${String(i).padStart(2, '0')}`, 'alice', 1000 + i);
  for (const state of ['pending', 'processing', 'failed'])
    await seed(`own-${state}`, 'alice', 2000, state);
  await seed('unfollowed', 'bob', 3000);
  await seed('pending-follow', 'carol', 4000);
  await runtime.request('alice', '/api/people/carol/request', 'POST');
  const first = await feed();
  expect(first.items.map((p) => p.id)).toEqual(
    Array.from(
      { length: 12 },
      (_, i) => `own-${String(13 - i).padStart(2, '0')}`,
    ),
  );
  expect(first.next).not.toBeNull();
  expect(
    (await runtime.request('alice', '/api/posts/own-01', 'DELETE')).status,
  ).toBe(200);
  const second = await feed(first.next!);
  expect(second.items).toHaveLength(1);
  expect(second.items[0]).toMatchObject({ id: 'own-00', isOwner: true });
  expect(second.next).toBeNull();
  expect(
    await runtime.db
      .prepare('SELECT 1 FROM follow WHERE follower_id=target_id')
      .first(),
  ).toBeNull();
});
it('applies current membership, pending follows and blocks to older cursors', async () => {
  for (let i = 0; i < 18; i++) await seed(`bob-${i}`, 'bob', i + 1);
  for (let i = 0; i < 18; i++) await seed(`carol-${i}`, 'carol', i + 1);
  await runtime.request('alice', '/api/people/carol/request', 'POST');
  const first = await feed();
  expect(first.items.every((p) => p.id.startsWith('bob'))).toBe(true);
  await runtime.request('bob', '/api/people/alice/block', 'POST');
  expect((await feed(first.next!)).items).toEqual([]);
  await runtime.request('carol', '/api/people/alice/accept', 'POST');
  expect(
    (await feed(first.next!)).items.every((p) => p.id.startsWith('carol')),
  ).toBe(true);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='carol'")
    .run();
  try {
    expect((await feed(first.next!)).items).toEqual([]);
  } finally {
    await runtime.db
      .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
      .run();
  }
});
it('bounds feed and profile reads despite unrelated photos, with or without planner statistics', async () => {
  await runtime.db
    .prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000)
    INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height)
    SELECT 'noise-'||n,'carol','','',n,n,'published','posts/noise-'||n,1,1 FROM seq`,
    )
    .run();
  for (let i = 0; i < 30; i++) {
    await seed(`bob-${i}`, 'bob', i + 1);
    await seed(`own-${i}`, 'alice', i + 1);
  }
  const db = measuredDatabase(runtime.db as unknown as D1Database);
  for (const analyzed of [false, true]) {
    if (analyzed) await runtime.db.prepare('ANALYZE').run();
    for (const handle of [null, 'bob', 'alice']) {
      for (const cursor of [null, { snapshot: 20000, before: 15, id: '' }]) {
        const metrics = emptyMetrics();
        const page = await requestMetrics.run(metrics, () =>
          listPosts(db, 'alice', handle, cursor),
        );
        expect(page.items).toHaveLength(12);
        if (handle)
          expect(page.items.every((post) => post.handle === handle)).toBe(true);
        expect(metrics.rowsRead).toBeLessThan(1500);
        expect(metrics.queries).toBe(cursor ? 1 : 2);
      }
    }
  }
  await runtime.request('alice', '/api/people/bob/unfollow', 'POST');
  const ownMetrics = emptyMetrics();
  const ownPage = await requestMetrics.run(ownMetrics, () =>
    listPosts(db, 'alice', null, null),
  );
  expect(ownPage.items).toHaveLength(12);
  expect(ownPage.items.every((post) => post.isOwner)).toBe(true);
  expect(ownMetrics.rowsRead).toBeLessThan(500);
  await runtime.db.prepare("DELETE FROM post WHERE user_id='alice'").run();
  const metrics = emptyMetrics();
  expect(
    (
      await requestMetrics.run(metrics, () =>
        listPosts(db, 'alice', null, null),
      )
    ).items,
  ).toEqual([]);
  expect(metrics.rowsRead).toBeLessThan(25);
});
it('revokes post, media and profile-feed access after removal or blocking', async () => {
  await seed('private', 'bob', 1000);
  await seed('own', 'alice', 500);
  expect((await runtime.request(null, '/api/posts/private')).status).toBe(401);
  expect((await runtime.request('carol', '/api/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('carol', '/media/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    200,
  );
  const dto = (await (
    await runtime.request('alice', '/api/posts/private')
  ).json()) as { post: Record<string, unknown> };
  expect(dto.post).not.toHaveProperty('objectKey');
  expect(dto.post).not.toHaveProperty('ownerId');
  await runtime.request('bob', '/api/people/alice/remove', 'POST');
  expect((await runtime.request('alice', '/api/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/api/posts?handle=bob')).status).toBe(
    404,
  );
  expect((await feed()).items.map((p) => p.id)).toEqual(['own']);
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
  await runtime.request('alice', '/api/people/bob/block', 'POST');
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    404,
  );
  expect((await feed()).items.map((p) => p.id)).toEqual(['own']);
});
it('keeps drafts private and deletes posts immediately with durable cleanup', async () => {
  await seed('draft', 'bob', 1000, 'pending');
  await seed('published', 'bob', 2000);
  expect((await runtime.request('alice', '/api/posts/draft')).status).toBe(404);
  expect((await runtime.request('bob', '/api/posts/draft')).status).toBe(200);
  expect((await runtime.request('bob', '/media/posts/draft')).status).toBe(404);
  expect(
    (await runtime.request('alice', '/api/posts/published', 'DELETE')).status,
  ).toBe(404);
  expect(
    (await runtime.request('bob', '/api/posts/published', 'DELETE')).status,
  ).toBe(200);
  expect(
    (await runtime.request('bob', '/api/posts/published', 'DELETE')).status,
  ).toBe(200);
  expect((await runtime.request('bob', '/media/posts/published')).status).toBe(
    404,
  );
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await cleanupPosts(
    runtime.db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  expect(await bucket.get('posts/published.webp')).toBeNull();
});
it('rejects malformed cursors without broadening access', async () => {
  expect((await runtime.request('alice', '/api/posts?cursor=bad')).status).toBe(
    400,
  );
  expect(
    (
      await runtime.request(
        'alice',
        '/api/posts?cursor=' +
          btoa(JSON.stringify({ snapshot: -1, before: 2, id: 'x' })),
      )
    ).status,
  ).toBe(400);
});
it('edits only an owned published caption, preserves image/order, and safely repeats a save', async () => {
  await seed('edit', 'bob', 1234);
  await seed('draft-edit', 'bob', 1235, 'pending');
  const before = await runtime.db
    .prepare('SELECT * FROM post WHERE id=?')
    .bind('edit')
    .first();
  for (const actor of [null, 'alice', 'carol']) {
    expect(
      (
        await runtime.request(actor, '/api/posts/edit', 'PATCH', {
          caption: 'no',
        })
      ).status,
    ).toBe(actor ? 404 : 401);
  }
  expect(
    (
      await runtime.request('bob', '/api/posts/draft-edit', 'PATCH', {
        caption: 'no',
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await runtime.request(
        'bob',
        '/api/posts/edit',
        'PATCH',
        { caption: 'no' },
        { Origin: 'https://other.invalid' },
      )
    ).status,
  ).toBe(403);
  for (const payload of [
    {},
    { caption: 2 },
    { caption: 'x'.repeat(2001) },
    { caption: 'text', object_key: 'other' },
    { caption: 'text', published_at: 9999 },
  ])
    expect(
      (await runtime.request('bob', '/api/posts/edit', 'PATCH', payload))
        .status,
    ).toBe(400);
  for (let i = 0; i < 2; i++) {
    const response = await runtime.request('bob', '/api/posts/edit', 'PATCH', {
      caption: '  Updated\ncaption  ',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ caption: 'Updated\ncaption' });
  }
  expect(
    await runtime.db
      .prepare('SELECT * FROM post WHERE id=?')
      .bind('edit')
      .first(),
  ).toEqual({ ...before, caption: 'Updated\ncaption' });
  expect((await feed()).items[0]).toMatchObject({
    caption: 'Updated\ncaption',
  });
  expect(
    (await runtime.request('bob', '/api/posts/edit', 'PATCH', { caption: '' }))
      .status,
  ).toBe(200);
  await runtime.request('bob', '/api/posts/edit', 'DELETE');
  expect(
    (
      await runtime.request('bob', '/api/posts/edit', 'PATCH', {
        caption: 'revive',
      })
    ).status,
  ).toBe(404);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  try {
    expect(
      await editCaption(
        runtime.db as unknown as D1Database,
        'bob',
        'draft-edit',
        'no',
      ),
    ).toBe(false);
  } finally {
    await runtime.db
      .prepare("UPDATE membership SET status='active' WHERE user_id='bob'")
      .run();
  }
});
async function processingEnv() {
  const output = readFileSync('tests/fixtures/photos/still.webp');
  const transform = vi.fn(async () => ({
    response: () => new Response(output),
  }));
  const images = {
    info: async () => ({
      format: 'image/webp',
      width: 120,
      height: 80,
      fileSize: output.length,
    }),
    input: () => ({ transform: () => ({ output: transform }) }),
  };
  return {
    env: {
      DB: runtime.db,
      PHOTOS: await runtime.worker.getR2Bucket('PHOTOS'),
      IMAGES: images,
    } as unknown as Env,
    transform,
  };
}
it('atomically rolls back draft allowance when inserting the draft fails', async () => {
  const db = runtime.db as unknown as D1Database;
  const draft = { id: crypto.randomUUID(), caption: 'Retry', altText: '' };
  await db
    .prepare(
      "CREATE TRIGGER fail_draft BEFORE INSERT ON post BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
    )
    .run();
  try {
    await expect(createDraft(db, 'alice', draft)).rejects.toThrow();
    expect(
      await db
        .prepare('SELECT id FROM photo_attempt WHERE id=?')
        .bind(`alice:post/${draft.id}`)
        .first(),
    ).toBeNull();
  } finally {
    await db.prepare('DROP TRIGGER fail_draft').run();
  }
  expect(await createDraft(db, 'alice', draft)).toBe('pending');
});
it('resumes an interrupted legacy reservation without charging allowance twice', async () => {
  const db = runtime.db as unknown as D1Database;
  const draft = { id: crypto.randomUUID(), caption: 'Retry', altText: '' };
  expect(await reservePhoto(db, 'alice', `post/${draft.id}`, 2)).toBe(
    'reserved',
  );
  expect(await createDraft(db, 'alice', draft)).toBe('pending');
  expect(await createDraft(db, 'alice', draft)).toBe('pending');
  expect(
    await db
      .prepare(
        'SELECT SUM(processing_units) AS units FROM photo_attempt WHERE user_id=?',
      )
      .bind('alice')
      .first('units'),
  ).toBe(2);
});
it('handles concurrent drafts and an unconfirmed commit without duplicate posts or allowance', async () => {
  const db = runtime.db as unknown as D1Database;
  const draft = { id: crypto.randomUUID(), caption: 'Retry', altText: '' };
  const uncertain = new Proxy(db, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          await target.batch(statements);
          throw new Error('Response lost after commit');
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(createDraft(uncertain, 'alice', draft)).rejects.toThrow(
    'Response lost',
  );
  expect(await createDraft(db, 'alice', draft)).toBe('pending');
  const concurrent = { ...draft, id: crypto.randomUUID() };
  expect(
    await Promise.all([
      createDraft(db, 'alice', concurrent),
      createDraft(db, 'alice', concurrent),
    ]),
  ).toEqual(['pending', 'pending']);
  expect(
    await createDraft(db, 'alice', { ...concurrent, caption: 'Different' }),
  ).toBe('conflict');
  expect(
    await db
      .prepare('SELECT COUNT(*) FROM post WHERE user_id=?')
      .bind('alice')
      .first('COUNT(*)'),
  ).toBe(2);
  expect(
    await db
      .prepare(
        'SELECT SUM(processing_units) FROM photo_attempt WHERE user_id=?',
      )
      .bind('alice')
      .first('SUM(processing_units)'),
  ).toBe(4);
});
it('publishes one processed object and makes retries idempotent', async () => {
  const { env, transform } = await processingEnv();
  const id = crypto.randomUUID();
  const draft = { id, caption: 'Caption', altText: 'Description' };
  expect(await createDraft(env.DB, 'alice', draft)).toBe('pending');
  expect(await createDraft(env.DB, 'alice', draft)).toBe('pending');
  const request = () =>
    new Request('http://localhost/upload', {
      method: 'PUT',
      body: readFileSync('tests/fixtures/photos/still.png'),
    });
  expect(await publishPhoto(env, 'alice', id, request())).toBe('published');
  expect(await publishPhoto(env, 'alice', id, request())).toBe('published');
  expect(transform).toHaveBeenCalledTimes(1);
  expect(await createDraft(env.DB, 'alice', draft)).toBe('published');
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS count FROM post').first(),
  ).toEqual({ count: 1 });
  expect(
    await runtime.db.prepare('SELECT 1 FROM photo_cleanup').first(),
  ).toBeNull();
});
it('leaves failed processing unpublished and its cleanup intent retryable', async () => {
  const { env, transform } = await processingEnv();
  transform.mockRejectedValue(new Error('Provider unavailable'));
  const id = crypto.randomUUID();
  await createDraft(env.DB, 'alice', { id, caption: '', altText: '' });
  await expect(
    publishPhoto(
      env,
      'alice',
      id,
      new Request('http://localhost/upload', {
        method: 'PUT',
        body: readFileSync('tests/fixtures/photos/still.png'),
      }),
    ),
  ).rejects.toThrow('unavailable');
  expect(
    await runtime.db
      .prepare('SELECT state,object_key FROM post WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ state: 'failed', object_key: null });
  expect((await runtime.request('alice', `/media/posts/${id}`)).status).toBe(
    404,
  );
});
it('rejects a competing upload and cannot publish after deletion during processing', async () => {
  const { env, transform } = await processingEnv();
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let entered!: () => void;
  const processing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  transform.mockImplementation(async () => {
    entered();
    await paused;
    return {
      response: () =>
        new Response(readFileSync('tests/fixtures/photos/still.webp')),
    };
  });
  const id = crypto.randomUUID();
  await createDraft(env.DB, 'alice', { id, caption: '', altText: '' });
  const request = () =>
    new Request('http://localhost/upload', {
      method: 'PUT',
      body: readFileSync('tests/fixtures/photos/still.png'),
    });
  const first = publishPhoto(env, 'alice', id, request());
  await processing;
  // Real D1 and Worker reads complete while the image-provider boundary waits.
  const startup = await runtime.request('bob', '/api/bootstrap');
  expect(startup.status).toBe(200);
  expect(await startup.json()).toMatchObject({ user: { id: 'bob' } });
  expect((await runtime.request('bob', '/api/posts')).status).toBe(200);
  expect(await publishPhoto(env, 'alice', id, request())).toBe('conflict');
  expect(
    (await runtime.request('alice', `/api/posts/${id}`, 'DELETE')).status,
  ).toBe(200);
  resume();
  expect(await first).toBe('conflict');
  expect(transform).toHaveBeenCalledTimes(1);
  expect((await runtime.request('alice', `/media/posts/${id}`)).status).toBe(
    404,
  );
  const intent = await runtime.db
    .prepare('SELECT object_key FROM photo_cleanup')
    .first<{ object_key: string }>();
  expect(intent).not.toBeNull();
  expect(await env.PHOTOS.head(intent!.object_key)).not.toBeNull();
  await runtime.db.prepare('UPDATE photo_cleanup SET not_before=0').run();
  await cleanupPosts(env.DB, env.PHOTOS);
  expect(await env.PHOTOS.head(intent!.object_key)).toBeNull();
});

it('does not charge a losing owner when two accounts race for the same draft ID', async () => {
  const db = runtime.db as unknown as D1Database;
  const draft = { id: crypto.randomUUID(), caption: 'Collision', altText: '' };
  const results = await Promise.all(
    ['alice', 'bob'].map((actor) => createDraft(db, actor, draft)),
  );
  expect(results.sort()).toEqual(['conflict', 'pending']);
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM photo_attempt')
      .first('count'),
  ).toBe(1);
});

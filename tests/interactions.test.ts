import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { testRuntime } from './support/runtime';
import { addComment, setLike } from '../src/server/features/interactions';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
const postId = '11111111-1111-4111-8111-111111111111';
const base = `/api/interactions/${postId}`;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'notification_read',
      'post_like',
      'comment',
      'post',
      'follow',
      'block',
      'profile',
    ].map((t) => runtime.db.prepare(`DELETE FROM ${t}`)),
  );
  for (const id of ['alice', 'bob', 'carol', 'david'])
    expect(
      (
        await runtime.request(id, '/api/people/self', 'PUT', {
          handle: id,
          displayName: id,
          bio: id,
        })
      ).status,
    ).toBe(200);
  await runtime.db.prepare('DELETE FROM follow').run(); // Independent users for permission tests.
  await runtime.request('bob', '/api/people/alice/request', 'POST');
  await runtime.request('alice', '/api/people/bob/accept', 'POST');
  await runtime.db
    .prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,'alice','test','test',1,1,'published','posts/test.webp',1,1)",
    )
    .bind(postId)
    .run();
});
async function comments(actor = 'bob', after = '') {
  const response = await runtime.request(
    actor,
    `${base}/comments?after=${encodeURIComponent(after)}`,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    items: { id: string; body: string; canDelete: number }[];
    next: string | null;
  }>;
}
async function notices(actor = 'alice', cursor = '') {
  const response = await runtime.request(
    actor,
    `/api/notifications?cursor=${encodeURIComponent(cursor)}`,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    items: {
      key: string;
      kind: string;
      count: number;
      createdAt: number;
      unread: number;
    }[];
    next: string | null;
  }>;
}
async function counts() {
  return (
    (await (await runtime.request('alice', `/api/posts/${postId}`)).json()) as {
      post: { likeCount: number; commentCount: number };
    }
  ).post;
}
it('keeps concurrent duplicate likes and comments idempotent and counts authoritative', async () => {
  const likes = await Promise.all([
    runtime.request('bob', `${base}/like`, 'PUT'),
    runtime.request('bob', `${base}/like`, 'PUT'),
  ]);
  expect(likes.map((r) => r.status)).toEqual([200, 200]);
  const id = crypto.randomUUID();
  const added = await Promise.all([
    runtime.request('bob', `${base}/comments`, 'POST', { id, body: 'Hello' }),
    runtime.request('bob', `${base}/comments`, 'POST', { id, body: 'Hello' }),
  ]);
  expect(added.map((r) => r.status)).toEqual([200, 200]);
  expect(await counts()).toMatchObject({ likeCount: 1, commentCount: 1 });
  expect((await comments()).items).toHaveLength(1);
  expect(
    (
      await runtime.request('bob', `${base}/comments`, 'POST', {
        id,
        body: 'Changed',
      })
    ).status,
  ).toBe(409);
  await runtime.request('bob', `${base}/like`, 'DELETE');
  await runtime.request('bob', `${base}/like`, 'DELETE');
  expect((await counts()).likeCount).toBe(0);
});
it('denies strangers, pending follows, revoked follows, deleted posts, and direct unauthorized mutations', async () => {
  expect((await runtime.request(null, `${base}/like`, 'PUT')).status).toBe(401);
  for (const method of ['GET', 'POST'])
    expect(
      (
        await runtime.request(
          'carol',
          `${base}/comments`,
          method,
          method === 'POST'
            ? { id: crypto.randomUUID(), body: 'no' }
            : undefined,
        )
      ).status,
    ).toBe(404);
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  expect((await runtime.request('carol', `${base}/like`, 'PUT')).status).toBe(
    404,
  );
  await runtime.request('alice', '/api/people/bob/remove', 'POST');
  expect((await runtime.request('bob', `${base}/comments`)).status).toBe(404);
  const db = runtime.db as unknown as D1Database;
  expect(await setLike(db, 'bob', postId, true)).toBe(false);
  expect(await addComment(db, 'bob', postId, crypto.randomUUID(), 'no')).toBe(
    false,
  );
  await runtime.request('alice', `/api/posts/${postId}`, 'DELETE');
  expect((await runtime.request('alice', `${base}/like`, 'PUT')).status).toBe(
    404,
  );
});
it('allows author and post owner deletion, preserves tombstones, and prevents resurrection', async () => {
  const id = crypto.randomUUID();
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id,
    body: 'Delete me',
  });
  expect(
    (
      await runtime.request(
        'carol',
        `/api/interactions/comments/${id}`,
        'DELETE',
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await runtime.request(
        'alice',
        `/api/interactions/comments/${id}`,
        'DELETE',
      )
    ).status,
  ).toBe(200);
  expect(
    (await runtime.request('bob', `/api/interactions/comments/${id}`, 'DELETE'))
      .status,
  ).toBe(200);
  expect(
    (
      await runtime.request('bob', `${base}/comments`, 'POST', {
        id,
        body: 'Delete me',
      })
    ).status,
  ).toBe(409);
  expect((await counts()).commentCount).toBe(0);
  expect((await comments()).items).toHaveLength(0);
  expect((await notices()).items).toHaveLength(0);
  expect(
    await runtime.db
      .prepare('SELECT body FROM comment WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ body: '' });
});
it('paginates comments by time and ID across ties and hides blocked authors and their counts', async () => {
  const ids = Array.from({ length: 25 }, () => crypto.randomUUID())
    .sort()
    .reverse();
  await runtime.db.batch(
    ids.map((id) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'bob','Synthetic',1000)",
        )
        .bind(id, postId),
    ),
  );
  const first = await comments('alice');
  expect(first.items.map((c) => c.id)).toEqual(ids.slice(0, 20));
  const next = await comments('alice', first.next!);
  expect(next.items.map((c) => c.id)).toEqual(ids.slice(20));
  expect(next.next).toBeNull();
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.request('alice', '/api/people/bob/block', 'POST');
  expect((await comments('alice')).items).toHaveLength(0);
  expect(await counts()).toMatchObject({ likeCount: 0, commentCount: 0 });
  expect((await notices()).items).toHaveLength(0);
  expect((await runtime.request('bob', `${base}/comments`)).status).toBe(404);
});
it('enforces the comment budget even after deletions and validates input and cursors', async () => {
  await runtime.db.batch(
    Array.from({ length: 100 }, () =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at,deleted_at) VALUES(?,?,'bob','',?,?)",
        )
        .bind(crypto.randomUUID(), postId, Date.now(), Date.now()),
    ),
  );
  expect(
    (
      await runtime.request('bob', `${base}/comments`, 'POST', {
        id: crypto.randomUUID(),
        body: 'Over limit',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('alice', `${base}/comments`, 'POST', {
        id: crypto.randomUUID(),
        body: ' ',
      })
    ).status,
  ).toBe(400);
  expect(
    (await runtime.request('alice', `${base}/comments?after=broken`)).status,
  ).toBe(400);
  expect(
    (await runtime.request('alice', '/api/notifications?cursor=broken')).status,
  ).toBe(400);
});
it('derives request, grouped-like and comment notifications and clears obsolete events', async () => {
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  let page = await notices();
  expect(page.items.map((i) => i.kind)).toEqual(['request']);
  await runtime.request('alice', '/api/people/carol/accept', 'POST');
  expect((await notices()).items).toHaveLength(0);
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.request('carol', `${base}/like`, 'PUT');
  await runtime.request('alice', `${base}/like`, 'PUT');
  const id = crypto.randomUUID();
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id,
    body: 'Hi Alice',
  });
  page = await notices();
  expect(page.items).toHaveLength(2);
  expect(page.items.find((i) => i.kind === 'likes')?.count).toBe(2);
  expect(page.items.every((i) => i.unread === 1)).toBe(true);
  expect((await notices('bob')).items).toHaveLength(0);
  expect(
    (
      await runtime.request('alice', '/api/notifications/read', 'POST', {
        items: page.items.map(({ key, createdAt }) => ({ key, createdAt })),
      })
    ).status,
  ).toBe(200);
  expect((await notices()).items.every((i) => i.unread === 0)).toBe(true);
  await runtime.request('bob', `${base}/like`, 'DELETE');
  expect((await notices()).items.find((i) => i.kind === 'likes')?.count).toBe(
    1,
  );
  await runtime.request('bob', `/api/interactions/comments/${id}`, 'DELETE');
  expect((await notices()).items.some((i) => i.kind === 'comment')).toBe(false);
  await runtime.request('alice', `/api/posts/${postId}`, 'DELETE');
  expect((await notices()).items).toHaveLength(0);
});
it('does not acknowledge a newer notification from a stale page or store fabricated read records', async () => {
  await runtime.request('bob', `${base}/like`, 'PUT');
  const old = (await notices()).items;
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  await runtime.request('alice', '/api/people/carol/accept', 'POST');
  await runtime.request('carol', `${base}/like`, 'PUT');
  await runtime.request('alice', '/api/notifications/read', 'POST', {
    items: old,
  });
  expect((await notices()).items[0].unread).toBe(1);
  await runtime.request('alice', '/api/notifications/read', 'POST', {
    items: [{ key: 'comment:missing', createdAt: 1 }],
  });
  expect(
    await runtime.db
      .prepare(
        "SELECT 1 FROM notification_read WHERE event_key='comment:missing'",
      )
      .first(),
  ).toBeNull();
});
it('paginates notifications with tied timestamps and marks an older page read', async () => {
  const ids = Array.from({ length: 25 }, () => crypto.randomUUID());
  await runtime.db.batch(
    ids.map((id) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'bob','Hi',1000)",
        )
        .bind(id, postId),
    ),
  );
  const first = await notices(),
    second = await notices('alice', first.next!);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(5);
  expect(second.next).toBeNull();
  expect(
    new Set([...first.items, ...second.items].map((i) => i.key)).size,
  ).toBe(25);
  await runtime.request('alice', '/api/notifications/read', 'POST', {
    items: second.items,
  });
  expect(
    (await notices('alice', first.next!)).items.every((i) => !i.unread),
  ).toBe(true);
  expect((await notices()).items.every((i) => i.unread)).toBe(true);
});

it('lists likes only for viewers with post access and hides blocked identities', async () => {
  await runtime.request('alice', `${base}/like`, 'PUT');
  await runtime.request('bob', `${base}/like`, 'PUT');
  expect((await runtime.request('carol', `${base}/likes`)).status).toBe(404);
  expect((await runtime.request(null, `${base}/likes`)).status).toBe(401);
  const list = (await (
    await runtime.request('alice', `${base}/likes`)
  ).json()) as { items: { handle: string }[] };
  expect(list.items.map((x) => x.handle)).toEqual(['alice', 'bob']);
  await runtime.request('alice', '/api/people/bob/block', 'POST');
  expect(
    await (await runtime.request('alice', `${base}/likes`)).json(),
  ).toMatchObject({ items: [{ handle: 'alice' }] });
  expect((await runtime.request('bob', `${base}/likes`)).status).toBe(404);
});

import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import {
  addComment,
  setLike,
  setCommentLike,
} from '../src/server/features/interactions';
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
      'avatar',
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
  await seedProfilePhotos(runtime.db);
  await runtime.db.prepare('DELETE FROM follow').run(); // Independent users for permission tests.
  await runtime.request('bob', '/api/people/alice/request', 'POST');
  await runtime.request('alice', '/api/people/bob/accept', 'POST');
  // The fixture grants post access; follower activity has its own integration tests.
  await runtime.db
    .prepare("DELETE FROM activity_source WHERE kind='follower'")
    .run();
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
    items: {
      id: string;
      body: string;
      canDelete: number;
      likeCount: number;
      liked: number;
    }[];
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
      version: number;
      unread: boolean;
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
  for (const response of likes)
    expect(await response.json()).toMatchObject({
      likeCount: 1,
      commentCount: 0,
      liked: 1,
    });
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
  for (let i = 0; i < 2; i++)
    expect(
      await (await runtime.request('bob', `${base}/like`, 'DELETE')).json(),
    ).toMatchObject({ likeCount: 0, commentCount: 1, liked: 0 });
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
it('derives request, follower, grouped-like and comment notifications and clears obsolete events', async () => {
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  let page = await notices();
  expect(page.items.map((i) => i.kind)).toEqual(['request']);
  await runtime.request('alice', '/api/people/carol/accept', 'POST');
  expect((await notices()).items).toMatchObject([{ kind: 'follower' }]);
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.request('carol', `${base}/like`, 'PUT');
  await runtime.request('alice', `${base}/like`, 'PUT');
  const id = crypto.randomUUID();
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id,
    body: 'Hi Alice',
  });
  page = await notices();
  expect(page.items).toHaveLength(3);
  expect(page.items.find((i) => i.kind === 'likes')?.count).toBe(2);
  // Alice accepted Carol herself, so that follower row arrives already read.
  for (const item of page.items)
    expect(item.unread).toBe(item.kind !== 'follower');
  expect((await notices('bob')).items).toHaveLength(0);
  await runtime.request('bob', `${base}/like`, 'DELETE');
  expect((await notices()).items.find((i) => i.kind === 'likes')?.count).toBe(
    1,
  );
  await runtime.request('bob', `/api/interactions/comments/${id}`, 'DELETE');
  expect((await notices()).items.some((i) => i.kind === 'comment')).toBe(false);
  await runtime.request('alice', `/api/posts/${postId}`, 'DELETE');
  expect((await notices()).items).toMatchObject([{ kind: 'follower' }]);
});
it('counts all activity, keeps GET read-only, and clears a seen request without deciding it', async () => {
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id: crypto.randomUUID(),
    body: 'Hello',
  });
  const first = await notices();
  expect(first.items).toHaveLength(3);
  expect(first.items.every((item) => item.unread)).toBe(true);
  expect(await notices()).toEqual(first);
  expect(await unread()).toBe(3);
  const request = first.items.find((item) => item.kind === 'request')!;
  for (let attempt = 0; attempt < 2; attempt++)
    expect(
      (
        await runtime.request('alice', '/api/notifications/read', 'POST', {
          items: [request],
        })
      ).status,
    ).toBe(200);
  expect(await unread()).toBe(2);
  expect(
    (await notices()).items.find((item) => item.key === request.key)?.unread,
  ).toBe(false);
  expect(
    await runtime.db
      .prepare(
        "SELECT status FROM follow WHERE follower_id='carol' AND target_id='alice'",
      )
      .first('status'),
  ).toBe('pending');
  expect((await notices()).items).toHaveLength(3);
});
async function unread(actor: string | null = 'alice') {
  const response = await runtime.request(
    actor,
    '/api/notifications/unread-count',
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { count: number }).count;
}
it('rejects malformed, unauthenticated and foreign-origin read receipts without clearing another member', async () => {
  await runtime.request('bob', `${base}/like`, 'PUT');
  const items = (await notices()).items;
  expect(
    (await runtime.request('bob', '/api/notifications/read', 'POST', { items }))
      .status,
  ).toBe(200);
  expect(await unread()).toBe(1);
  for (const body of [
    null,
    {},
    { items: [] },
    {
      items: Array(21).fill({ key: items[0].key, version: items[0].version }),
    },
    { items: [{ key: 'bad', version: 1 }] },
    { items: [{ key: items[0].key, version: -1 }] },
    { items: [{ key: items[0].key, version: Number.MAX_SAFE_INTEGER + 1 }] },
  ])
    expect(
      (await runtime.request('alice', '/api/notifications/read', 'POST', body))
        .status,
    ).toBe(400);
  expect(
    (await runtime.request(null, '/api/notifications/read', 'POST', { items }))
      .status,
  ).toBe(401);
  expect(
    (await runtime.request(null, '/api/notifications/unread-count')).status,
  ).toBe(401);
  expect(
    (
      await runtime.request(
        'alice',
        '/api/notifications/read',
        'POST',
        { items },
        { Origin: 'https://elsewhere.test' },
      )
    ).status,
  ).toBe(403);
  expect(await unread()).toBe(1);
});
it('paginates mixed activity with tied timestamps and keeps older pages available', async () => {
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
  await runtime.db.batch([
    runtime.db.prepare(
      "INSERT INTO follow VALUES('carol','alice','pending',1000)",
    ),
    runtime.db
      .prepare("INSERT INTO post_like VALUES(?,'bob',1000)")
      .bind(postId),
  ]);
  const first = await notices(),
    second = await notices('alice', first.next!);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(7);
  expect(second.next).toBeNull();
  expect(
    new Set([...first.items, ...second.items].map((i) => i.key)).size,
  ).toBe(27);
  expect(first.items.slice(0, 2).map((item) => item.kind)).toEqual([
    'request',
    'likes',
  ]);
  const keys = [...first.items, ...second.items].map((item) => item.key);
  expect(keys).toEqual([...keys].sort().reverse());
  expect(await notices('alice', first.next!)).toEqual(second);
  expect(await notices()).toEqual(first);
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
it('likes comments idempotently with private counts and a paginated likers list', async () => {
  const id = crypto.randomUUID();
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id,
    body: 'Hello',
  });
  const path = `/api/interactions/comments/${id}`;
  const duplicates = await Promise.all([
    runtime.request('alice', `${path}/like`, 'PUT'),
    runtime.request('alice', `${path}/like`, 'PUT'),
  ]);
  expect(duplicates.map((r) => r.status)).toEqual([200, 200]);
  await runtime.request('bob', `${path}/like`, 'PUT');
  expect((await comments('bob')).items[0]).toMatchObject({
    likeCount: 2,
    liked: 1,
  });
  expect(await (await runtime.request('bob', `${path}/likes`)).json()).toEqual({
    items: [{ handle: 'alice' }, { handle: 'bob' }],
    next: null,
  });
  expect(
    await (await runtime.request('bob', `${path}/likes?after=alice`)).json(),
  ).toEqual({ items: [{ handle: 'bob' }], next: null });
  expect(
    (await runtime.request('alice', `${path}/likes?after=invalid!`)).status,
  ).toBe(400);
  for (let i = 0; i < 2; i++)
    expect(
      await (await runtime.request('bob', `${path}/like`, 'DELETE')).json(),
    ).toEqual({ likeCount: 1, liked: 0 });
  for (const actor of [null, 'carol']) {
    for (const [suffix, method] of [
      ['like', 'PUT'],
      ['likes', 'GET'],
    ])
      expect(
        (await runtime.request(actor, `${path}/${suffix}`, method)).status,
      ).toBe(actor ? 404 : 401);
  }
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  expect((await runtime.request('carol', `${path}/like`, 'PUT')).status).toBe(
    404,
  );
  await runtime.request('alice', '/api/people/bob/remove', 'POST');
  expect(
    await setCommentLike(runtime.db as unknown as D1Database, 'bob', id, true),
  ).toBeNull();
  expect((await runtime.request('bob', `${path}/likes`)).status).toBe(404);
  await runtime.request('bob', `/api/interactions/comments/${id}`, 'DELETE');
  expect((await runtime.request('alice', `${path}/like`, 'PUT')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', `${path}/likes`)).status).toBe(404);
});
it('hides blocked/inactive comment likers and rejects access to a blocked author or deleted post', async () => {
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  await runtime.request('alice', '/api/people/carol/accept', 'POST');
  const id = crypto.randomUUID();
  await runtime.request('bob', `${base}/comments`, 'POST', {
    id,
    body: 'Hello',
  });
  const path = `/api/interactions/comments/${id}`;
  await runtime.request('carol', `${path}/like`, 'PUT');
  await runtime.request('bob', '/api/people/carol/block', 'POST');
  expect((await comments('bob')).items[0].likeCount).toBe(0);
  expect((await runtime.request('carol', `${path}/likes`)).status).toBe(404);
  expect(
    await (await runtime.request('bob', `${path}/likes`)).json(),
  ).toMatchObject({ items: [] });
  expect((await comments('alice')).items[0].likeCount).toBe(1);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='carol'")
    .run();
  try {
    expect((await comments('alice')).items[0].likeCount).toBe(0);
  } finally {
    await runtime.db
      .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
      .run();
  }
  await runtime.request('alice', `/api/posts/${postId}`, 'DELETE');
  expect((await runtime.request('alice', `${path}/likes`)).status).toBe(404);
  expect(
    await setCommentLike(runtime.db as unknown as D1Database, 'bob', id, true),
  ).toBeNull();
});

it('filters pending requests before pagination and preserves visibility and cursor boundaries', async () => {
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  await runtime.request('david', '/api/people/alice/request', 'POST');
  await runtime.db
    .prepare("UPDATE follow SET created_at=500 WHERE status='pending'")
    .run();
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.db.batch(
    Array.from({ length: 26 }, (_, i) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'bob','Comment',?)",
        )
        .bind(crypto.randomUUID(), postId, i === 25 ? 500 : 600),
    ),
  );
  expect((await notices()).items.some((item) => item.kind === 'request')).toBe(
    false,
  );
  async function filtered(cursor = '') {
    const response = await runtime.request(
      'alice',
      `/api/notifications?filter=requests&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      items: { key: string; kind: string }[];
      next: string | null;
    }>;
  }
  expect(await filtered()).toMatchObject({
    items: [
      { key: 'request:david', kind: 'request' },
      { key: 'request:carol', kind: 'request' },
    ],
    next: null,
  });
  expect(
    await filtered(btoa(JSON.stringify({ time: 500, key: 'request:david' }))),
  ).toMatchObject({ items: [{ key: 'request:carol' }] });
  await runtime.request('alice', '/api/people/carol/deny', 'POST');
  expect((await filtered()).items.map((item) => item.key)).toEqual([
    'request:david',
  ]);
  await runtime.request('alice', '/api/people/david/block', 'POST');
  expect((await filtered()).items).toEqual([]);
  expect(
    (await runtime.request(null, '/api/notifications?filter=requests')).status,
  ).toBe(401);
  expect(
    (await runtime.request('alice', '/api/notifications?filter=invalid'))
      .status,
  ).toBe(400);
});

it('paginates requests, grouped likes, and comments together in descending date order', async () => {
  await runtime.request('carol', '/api/people/alice/request', 'POST');
  await runtime.request('david', '/api/people/alice/request', 'POST');
  await runtime.request('bob', `${base}/like`, 'PUT');
  await runtime.db.batch([
    runtime.db.prepare(
      "UPDATE follow SET created_at=1200 WHERE follower_id='carol' AND target_id='alice'",
    ),
    runtime.db.prepare(
      "UPDATE follow SET created_at=800 WHERE follower_id='david' AND target_id='alice'",
    ),
    runtime.db.prepare('UPDATE post_like SET created_at=1000'),
    ...Array.from({ length: 25 }, (_, i) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'bob','Comment',?)",
        )
        .bind(crypto.randomUUID(), postId, i < 15 ? 1100 : 900),
    ),
  ]);
  const first = await notices();
  const second = await notices('alice', first.next!);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(8);
  expect(second.next).toBeNull();
  expect(first.items[0].key).toBe('request:carol');
  expect(first.items[16].kind).toBe('likes');
  expect(second.items.at(-1)?.key).toBe('request:david');
  const combined = [...first.items, ...second.items];
  expect(new Set(combined.map((item) => item.key)).size).toBe(28);
  expect(combined.map((item) => item.createdAt)).toEqual(
    combined.map((item) => item.createdAt).sort((a, b) => b - a),
  );
});

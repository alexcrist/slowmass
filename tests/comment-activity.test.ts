import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { seedProfilePhotos, testRuntime } from './support/runtime';
import {
  describeNotification,
  notificationPage,
  markRead,
  unreadCount,
} from '../src/server/features/notifications';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
const post = '11111111-1111-4111-8111-111111111111';
const query = '?includeComments=1';
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime.worker.dispose();
});
beforeEach(async () => {
  await runtime.reset();
  for (const id of ['alice', 'bob', 'carol', 'david'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare(
      "INSERT INTO follow VALUES('bob','alice','accepted',1),('carol','alice','accepted',1)",
    ),
    runtime.db.prepare('DELETE FROM activity_source'),
    runtime.db
      .prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,'alice','','',1,1,'published','posts/test',1,1)",
      )
      .bind(post),
  ]);
});
function db() {
  return runtime.db as unknown as D1Database;
}
async function comment(actor: string, id = crypto.randomUUID()) {
  const response = await runtime.request(
    actor,
    `/api/interactions/${post}/comments`,
    'POST',
    { id, body: 'Synthetic comment' },
  );
  expect(response.status).toBe(200);
  return id;
}
async function like(actor: string, id: string, method = 'PUT') {
  expect(
    (
      await runtime.request(
        actor,
        `/api/interactions/comments/${id}/like`,
        method,
      )
    ).status,
  ).toBe(200);
}
async function page(actor = 'bob', suffix = query) {
  const response = await runtime.request(actor, `/api/notifications${suffix}`);
  expect(response.status).toBe(200);
  return response.json() as ReturnType<typeof notificationPage>;
}
async function count(actor = 'bob', suffix = query) {
  return (await (
    await runtime.request(actor, `/api/notifications/unread-count${suffix}`)
  ).json()) as { count: number };
}

it('notifies prior commenters once, excludes self and owner duplicates, and supports focus/read/older clients', async () => {
  await comment('bob');
  await comment('bob');
  expect((await page()).items).toHaveLength(0);
  const id = await comment('carol');
  await comment('carol', id); // Lost-response retry.
  const items = (await page()).items;
  expect(items).toMatchObject([
    {
      key: `thread_comment:${id}`,
      kind: 'thread_comment',
      postId: post,
      handle: 'carol',
      body: 'Synthetic comment',
      unread: true,
    },
  ]);
  expect(items).toHaveLength(1);
  expect(
    (await page('alice')).items.filter((x) => x.key.endsWith(id)),
  ).toMatchObject([{ kind: 'comment' }]);
  expect((await page('carol')).items).toHaveLength(0);
  expect((await page('david')).items).toHaveLength(0);
  expect((await page('bob', '')).items).toHaveLength(0);
  expect(await count('bob', '')).toEqual({ count: 0 });
  expect(await count()).toEqual({ count: 1 });
  expect(
    (await page('bob', `${query}&focus=thread_comment:${id}`)).items[0].key,
  ).toBe(items[0].key);
  expect(
    (await runtime.request('bob', '/api/notifications/read', 'POST', { items }))
      .status,
  ).toBe(200);
  expect(await count()).toEqual({ count: 0 });
  await comment('alice'); // The owner replying also alerts participants.
  expect(await count()).toEqual({ count: 1 });
});

it('notifies comment authors of likes, handles concurrent retries, self-likes, unlike and stale receipts', async () => {
  const id = await comment('bob');
  await Promise.all([like('carol', id), like('carol', id)]);
  await like('bob', id);
  let items = (await page()).items;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    kind: 'comment_like',
    key: `comment_like:${id}.carol`,
    postId: post,
    handle: 'carol',
    body: 'Synthetic comment',
  });
  expect((await page('bob', '')).items).toHaveLength(0);
  await like('carol', id, 'DELETE');
  expect((await page()).items).toHaveLength(0);
  await like('carol', id);
  await markRead(db(), 'bob', items);
  expect(await count()).toEqual({ count: 1 });
  items = (await page()).items;
  await markRead(db(), 'bob', items);
  expect(await count()).toEqual({ count: 0 });
  // Photo owners receive comment likes too, without unknown kinds leaking to old clients.
  const own = await comment('alice');
  await like('carol', own);
  expect(
    (await page('alice')).items.some((x) => x.kind === 'comment_like'),
  ).toBe(true);
  expect(
    (await page('alice', '')).items.some((x) => x.kind === 'comment_like'),
  ).toBe(false);
});

it.each([
  'actor block',
  'owner block',
  'removed follow',
  'pending follow',
  'inactive actor',
  'inactive owner',
  'deleted post',
  'deleted comment',
])(
  'hides both types from lists, badges, receipts and delivery after %s',
  async (change) => {
    const own = await comment('bob');
    await comment('carol');
    await like('carol', own);
    const items = (await page()).items;
    expect(items).toHaveLength(2);
    const sql: Record<string, string> = {
      'actor block': "INSERT INTO block VALUES('carol','bob',1)",
      'owner block': "INSERT INTO block VALUES('alice','bob',1)",
      'removed follow':
        "DELETE FROM follow WHERE follower_id='bob' AND target_id='alice'",
      'pending follow':
        "UPDATE follow SET status='pending' WHERE follower_id='bob' AND target_id='alice'",
      'inactive actor':
        "UPDATE membership SET status='disabled' WHERE user_id='carol'",
      'inactive owner':
        "UPDATE membership SET status='disabled' WHERE user_id='alice'",
      'deleted post': "UPDATE post SET state='deleted'",
      'deleted comment': "UPDATE comment SET body='',deleted_at=1",
    };
    await runtime.db.prepare(sql[change]).run();
    expect((await page()).items).toHaveLength(0);
    expect(await count()).toEqual({ count: 0 });
    await markRead(db(), 'bob', items);
    for (const item of items)
      expect(
        await describeNotification(db(), 'bob', item.key, item.version),
      ).toBeNull();
    if (change === 'actor block') {
      await runtime.db.prepare('DELETE FROM block').run();
      expect(await count()).toEqual({ count: 2 }); // Hidden receipts were not cleared.
    }
    expect(
      (await runtime.request(null, `/api/notifications${query}`)).status,
    ).toBe(401);
    expect((await runtime.request(null, `/api/posts/${post}`)).status).toBe(
      401,
    );
  },
);

it('only enrolls live prior commenters with access when the new comment is written', async () => {
  const old = await comment('bob');
  await runtime.request('bob', `/api/interactions/comments/${old}`, 'DELETE');
  await comment('carol');
  expect((await page()).items).toHaveLength(0);
  await comment('bob');
  await runtime.request('alice', '/api/people/bob/remove', 'POST');
  await comment('carol');
  await runtime.db
    .prepare("INSERT INTO follow VALUES('bob','alice','accepted',1)")
    .run();
  expect((await page()).items).toHaveLength(0); // No delayed enrollment on refollow.
});

it('queues independent preferences, describes alerts, and suppresses queued alerts when access is lost', async () => {
  for (const category of ['thread_comment', 'comment_like'])
    expect(
      (
        await runtime.request('bob', '/api/notifications/preferences', 'PUT', {
          category,
          push: true,
          email: true,
        })
      ).status,
    ).toBe(200);
  await runtime.db
    .prepare(
      `INSERT INTO push_subscription(id,user_id,session_id,endpoint,p256dh,auth,created_at)
    SELECT 'comment-device','bob',id,'https://web.push.apple.com/synthetic','synthetic','synthetic',1 FROM session WHERE userId='bob' LIMIT 1`,
    )
    .run();
  const own = await comment('bob');
  await comment('carol');
  await like('carol', own);
  const items = (await page()).items;
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(
      await describeNotification(db(), 'bob', item.key, item.version),
    ).toMatchObject({
      category: item.kind,
      push: true,
      email: true,
      postId: post,
      body: 'Synthetic comment',
    });
    expect(
      await runtime.db
        .prepare('SELECT event_key FROM push_delivery WHERE event_key=?')
        .bind(item.key)
        .first('event_key'),
    ).toBe(item.key);
    expect(
      await runtime.db
        .prepare('SELECT event_key FROM email_delivery WHERE event_key=?')
        .bind(item.key)
        .first('event_key'),
    ).toBe(item.key);
  }
  await runtime.request('bob', '/api/notifications/preferences', 'PUT', {
    category: 'comment_like',
    push: false,
    email: false,
  });
  const liked = items.find((x) => x.kind === 'comment_like')!;
  expect(
    await describeNotification(db(), 'bob', liked.key, liked.version),
  ).toMatchObject({ push: false, email: false });
  await runtime.request('alice', '/api/people/bob/remove', 'POST');
  for (const item of items)
    expect(
      await describeNotification(db(), 'bob', item.key, item.version),
    ).toBeNull();
});

it('paginates tied comment activity and rolls back an interaction when fan-out fails', async () => {
  await comment('bob');
  const ids = Array.from({ length: 25 }, () => crypto.randomUUID());
  await runtime.db.batch(
    ids.map((id) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'carol','Synthetic',1000)",
        )
        .bind(id, post),
    ),
  );
  const first = await page();
  const second = await page(
    'bob',
    `${query}&cursor=${encodeURIComponent(first.next!)}`,
  );
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(5);
  expect(
    new Set([...first.items, ...second.items].map((x) => x.key)).size,
  ).toBe(25);
  expect(await unreadCount(db(), 'bob')).toBe(25);
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_comment_activity BEFORE INSERT ON activity_source WHEN NEW.kind='thread_comment' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    )
    .run();
  const id = crypto.randomUUID();
  try {
    await expect(
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,?,'carol','Synthetic',2000)",
        )
        .bind(id, post)
        .run(),
    ).rejects.toThrow();
    expect(
      await runtime.db
        .prepare('SELECT id FROM comment WHERE id=?')
        .bind(id)
        .first(),
    ).toBeNull();
  } finally {
    await runtime.db.prepare('DROP TRIGGER fail_comment_activity').run();
  }
});

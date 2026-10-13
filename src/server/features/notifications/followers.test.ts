import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  seedProfilePhotos,
  testRuntime,
} from '../../../../tests/support/runtime';
import type { Notification } from './index';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch([
    ...['comment', 'post', 'follow', 'block', 'avatar', 'profile'].map(
      (table) => runtime.db.prepare(`DELETE FROM ${table}`),
    ),
    runtime.db.prepare("UPDATE membership SET status='active'"),
  ]);
  for (const id of ['alice', 'bob', 'carol', 'david']) {
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  }
  await seedProfilePhotos(runtime.db);
  await runtime.db.prepare('DELETE FROM follow').run();
});
async function page(actor = 'alice', query = '') {
  const response = await runtime.request(actor, `/api/notifications${query}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    items: Notification[];
    next: string | null;
    focusFound?: boolean;
  }>;
}
async function accept() {
  expect(
    (await runtime.request('bob', '/api/people/alice/request', 'POST')).status,
  ).toBe(200);
  expect(
    (await runtime.request('alice', '/api/people/bob/accept', 'POST')).status,
  ).toBe(200);
}
async function acknowledge(actor: string, items: Notification[]) {
  expect(
    (await runtime.request(actor, '/api/notifications/read', 'POST', { items }))
      .status,
  ).toBe(200);
}
it('replaces the request with unread follower activity, authorizes receipts, and makes acceptance idempotent', async () => {
  await runtime.request('bob', '/api/people/alice/request', 'POST');
  const request = (await page()).items;
  await acknowledge('alice', request);
  await runtime.request('alice', '/api/people/bob/accept', 'POST');
  const follower = (await page()).items;
  expect(follower).toHaveLength(1);
  expect(follower[0]).toMatchObject({
    key: 'follower:bob',
    kind: 'follower',
    handle: 'bob',
    unread: true,
    postId: null,
  });
  expect(follower[0].version).toBeGreaterThan(request[0].version);
  expect(follower[0].createdAt).toBeGreaterThan(Date.now() - 5000);
  expect((await page('alice', '?filter=requests')).items).toEqual([]);
  expect((await page('bob')).items).toEqual([]);
  expect(
    await (
      await runtime.request('alice', '/api/notifications/unread-count')
    ).json(),
  ).toEqual({ count: 1 });
  expect(await page('alice', '?focus=follower:bob')).toMatchObject({
    focusFound: true,
    items: follower,
  });
  expect(await page('carol', '?focus=follower:bob')).toMatchObject({
    focusFound: false,
    items: [],
  });
  await acknowledge('carol', follower);
  await acknowledge('alice', request);
  expect((await page()).items).toEqual(follower);
  await Promise.all([
    acknowledge('alice', follower),
    acknowledge('alice', follower),
  ]);
  await runtime.request('alice', '/api/people/bob/accept', 'POST');
  expect((await page()).items).toEqual([{ ...follower[0], unread: false }]);
  expect(
    await (
      await runtime.request('alice', '/api/notifications/unread-count')
    ).json(),
  ).toEqual({ count: 0 });
});
it('removes old follower events and never lets delayed receipts acknowledge a later follow', async () => {
  await accept();
  const old = (await page()).items;
  for (const [actor, action] of [
    ['bob', 'unfollow'],
    ['alice', 'remove'],
    ['alice', 'block'],
  ] as const) {
    const target = actor === 'alice' ? 'bob' : 'alice';
    expect(
      (await runtime.request(actor, `/api/people/${target}/${action}`, 'POST'))
        .status,
    ).toBe(200);
    expect((await page()).items).toEqual([]);
    expect(
      await runtime.db
        .prepare('SELECT COUNT(*) AS n FROM activity_read_state')
        .first('n'),
    ).toBe(0);
    if (action === 'block')
      await runtime.request('alice', '/api/people/bob/unblock', 'POST');
    await accept();
    await acknowledge('alice', old);
    const current = (await page()).items[0];
    expect(current.unread).toBe(true);
    expect(current.version).toBeGreaterThan(old[0].version);
  }
});
it('hides follower activity for blocks in either direction, inactive members, and incomplete profiles', async () => {
  await accept();
  const original = (await page()).items;
  for (const [hide, restore] of [
    ["INSERT INTO block VALUES('alice','bob',1)", 'DELETE FROM block'],
    ["INSERT INTO block VALUES('bob','alice',1)", 'DELETE FROM block'],
    [
      "UPDATE membership SET status='disabled' WHERE user_id='bob'",
      "UPDATE membership SET status='active' WHERE user_id='bob'",
    ],
  ]) {
    await runtime.db.prepare(hide).run();
    expect((await page()).items).toEqual([]);
    expect(
      await (
        await runtime.request('alice', '/api/notifications/unread-count')
      ).json(),
    ).toEqual({ count: 0 });
    await acknowledge('alice', original);
    await runtime.db.prepare(restore).run();
    expect((await page()).items).toEqual(original);
  }
  await runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'").run();
  expect((await page()).items).toEqual([]);
});
it('notifies both invitation participants once photo setup completes, without replay on profile edits or photo replacement', async () => {
  await runtime.db.batch([
    runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'"),
    runtime.db.prepare("DELETE FROM profile WHERE user_id='bob'"),
  ]);
  await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'bob',
    displayName: 'Bob',
    bio: '',
  });
  expect(
    await runtime.db
      .prepare("SELECT COUNT(*) AS n FROM follow WHERE status='accepted'")
      .first('n'),
  ).toBe(2);
  expect((await page()).items).toEqual([]);
  await seedProfilePhotos(runtime.db);
  const alice = (await page()).items;
  const bob = (await page('bob')).items;
  expect(alice).toMatchObject([{ key: 'follower:bob', unread: true }]);
  expect(bob).toMatchObject([{ key: 'follower:alice', unread: true }]);
  await acknowledge('alice', alice);
  await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'bob',
    displayName: 'New name',
    bio: 'Updated',
  });
  await runtime.db
    .prepare("UPDATE avatar SET object_key='replacement' WHERE user_id='bob'")
    .run();
  expect((await page()).items).toEqual([{ ...alice[0], unread: false }]);
  expect((await page('bob')).items).toEqual(bob);
  await runtime.request('bob', '/api/people/alice/unfollow', 'POST');
  await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'bob',
    displayName: 'Bob',
    bio: '',
  });
  expect((await page()).items).toEqual([]);
});
it('rolls back acceptance when follower activity cannot be recorded', async () => {
  await runtime.request('bob', '/api/people/alice/request', 'POST');
  const original = (await page()).items;
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_follower BEFORE INSERT ON activity_source WHEN NEW.kind='follower' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
    )
    .run();
  try {
    expect(
      (await runtime.request('alice', '/api/people/bob/accept', 'POST')).status,
    ).toBe(500);
    expect((await page()).items).toEqual(original);
    expect(
      await runtime.db
        .prepare(
          "SELECT status FROM follow WHERE follower_id='bob' AND target_id='alice'",
        )
        .first('status'),
    ).toBe('pending');
  } finally {
    await runtime.db.prepare('DROP TRIGGER fail_follower').run();
  }
});

it('does not create follower events for cancelled or denied requests', async () => {
  for (const [actor, target, action] of [
    ['bob', 'alice', 'cancel'],
    ['alice', 'bob', 'deny'],
  ] as const) {
    await runtime.request('bob', '/api/people/alice/request', 'POST');
    await runtime.request(actor, `/api/people/${target}/${action}`, 'POST');
    expect((await page()).items).toEqual([]);
    expect(
      await runtime.db
        .prepare('SELECT COUNT(*) AS n FROM activity_read_state')
        .first('n'),
    ).toBe(0);
  }
});

it('paginates follower events with requests and comments without duplicating timestamp ties', async () => {
  await accept();
  await runtime.db.batch([
    runtime.db.prepare(
      "UPDATE activity_source SET created_at=1234 WHERE kind='follower'",
    ),
    runtime.db.prepare(
      "INSERT INTO follow VALUES('carol','alice','pending',1234)",
    ),
    runtime.db.prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('page','alice','','',1,1,'published','posts/page',1,1)",
    ),
    ...Array.from({ length: 25 }, (_, i) =>
      runtime.db
        .prepare(
          "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,'page','bob','Synthetic',?)",
        )
        .bind(`page-${i}`, i < 15 ? 1234 : 1000),
    ),
  ]);
  const first = await page();
  const second = await page(
    'alice',
    `?cursor=${encodeURIComponent(first.next!)}`,
  );
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(7);
  expect(second.next).toBeNull();
  expect(first.items.slice(0, 2).map((item) => item.key)).toEqual([
    'request:carol',
    'follower:bob',
  ]);
  const items = [...first.items, ...second.items];
  expect(new Set(items.map((item) => item.key)).size).toBe(27);
  expect(items.map((item) => item.createdAt)).toEqual(
    items.map((item) => item.createdAt).sort((a, b) => b - a),
  );
});

it('migrates existing activity atomically without replay, losing receipts, pending pushes, or revision history', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 19);
  const db = old.db;
  const statements = unstable_splitSqlQuery(
    readFileSync('migrations/0020_follower_activity.sql', 'utf8'),
  );
  try {
    for (const id of ['alice', 'bob', 'carol', 'david'])
      await old.request(id, '/api/people/self', 'PUT', {
        handle: id,
        displayName: id,
        bio: '',
      });
    await seedProfilePhotos(db);
    await db.prepare('DELETE FROM follow').run();
    await db.batch([
      db.prepare(
        "INSERT INTO push_subscription VALUES('device','alice','alice','https://fcm.googleapis.com/fcm/send/synthetic','synthetic-key','synthetic-auth',1)",
      ),
      db.prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('photo','alice','','',1,1,'published','posts/photo',1,1)",
      ),
      db.prepare("INSERT INTO follow VALUES('bob','alice','pending',1000)"),
      db.prepare("INSERT INTO follow VALUES('alice','bob','accepted',1000)"),
      db.prepare("INSERT INTO post_like VALUES('photo','carol',2000)"),
      db.prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('comment','photo','bob','Synthetic',3000)",
      ),
      db.prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE event_key='likes:photo'",
      ),
      db.prepare(
        "UPDATE push_delivery SET attempts=2,lease='synthetic-lease',lease_until=9000 WHERE event_key='comment:comment'",
      ),
      db.prepare("INSERT INTO follow VALUES('david','alice','pending',4000)"),
      db.prepare("DELETE FROM follow WHERE follower_id='david'"),
    ]);
    async function snapshot() {
      return Promise.all(
        [
          'activity_source',
          'activity_read_state',
          'push_delivery',
          'sqlite_sequence',
        ].map(
          async (table) =>
            (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())
              .results,
        ),
      );
    }
    const before = await snapshot();
    const highwater = await db
      .prepare(
        "SELECT seq FROM sqlite_sequence WHERE name='activity_read_state'",
      )
      .first<number>('seq');
    // A failed batch restores even the sources/cascaded receipts already rebuilt.
    await expect(
      db.batch(
        [
          ...statements,
          "INSERT INTO follow VALUES('bob','alice','pending',1)",
        ].map((sql) => db.prepare(sql)),
      ),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await db.batch(statements.map((sql) => db.prepare(sql)));
    expect(await snapshot()).toEqual(before);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    await old.request('alice', '/api/people/bob/accept', 'POST');
    const next = await db
      .prepare(
        "SELECT revision FROM activity_read_state WHERE event_key='follower:bob'",
      )
      .first<number>('revision');
    expect(next).toBeGreaterThan(highwater!);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM activity_source WHERE kind='follower'",
        )
        .first('n'),
    ).toBe(1);
    expect(
      await db
        .prepare(
          "SELECT version FROM push_delivery WHERE event_key='follower:bob'",
        )
        .first('version'),
    ).toBe(next);
  } finally {
    await old.worker.dispose();
  }
});

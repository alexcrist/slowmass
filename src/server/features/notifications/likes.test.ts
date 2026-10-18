import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from '../../../../tests/support/runtime';
import {
  markRead,
  notificationPage,
  unreadCount,
  validNotificationKey,
} from './index';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
async function profiles(target: typeof runtime) {
  for (const id of ['alice', 'bob', 'carol', 'david'])
    await target.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
}
beforeAll(async () => {
  runtime = await testRuntime();
  await profiles(runtime);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM comment'),
    runtime.db.prepare('DELETE FROM post_like'),
    runtime.db.prepare('DELETE FROM post'),
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare('DELETE FROM block'),
  ]);
});
type Db = Awaited<ReturnType<typeof testRuntime>>['db'];
async function photo(db: Db, id: string) {
  await db
    .prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,'alice','','',1,1,'published',?,1,1)",
    )
    .bind(id, `posts/${id}`)
    .run();
}
async function like(db: Db, post: string, user: string, time: number) {
  await db
    .prepare('INSERT INTO post_like VALUES(?,?,?)')
    .bind(post, user, time)
    .run();
}
async function comment(db: Db, id: string, time: number) {
  await db
    .prepare(
      "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,'p','bob','Nice',?)",
    )
    .bind(id, time)
    .run();
}
const db = () => runtime.db as unknown as D1Database;
async function page() {
  return (await notificationPage(db(), 'alice', null)).items.map(
    ({ key, kind, count, more, unread, version }) => ({
      key,
      kind,
      count,
      more,
      unread,
      version,
    }),
  );
}

it('keeps like groups in timeline order around other activity', async () => {
  await photo(runtime.db, 'p');
  await photo(runtime.db, 'q');
  await like(runtime.db, 'p', 'bob', 1000);
  await like(runtime.db, 'p', 'carol', 1100);
  await comment(runtime.db, 'comment-1', 1200);
  await like(runtime.db, 'p', 'david', 1300);
  let items = await page();
  expect(items).toMatchObject([
    { kind: 'likes', count: 1, more: true },
    { key: 'comment:comment-1', more: false },
    { key: 'likes:p', count: 2, more: false },
  ]);
  const later = items[0].key;
  expect(later).toMatch(/^likes:p-[0-9a-f]{12}$/);
  expect(validNotificationKey(later)).toBe(true);
  expect(await unreadCount(db(), 'alice')).toBe(3);

  // Reading the newer group leaves the earlier group and comment unread.
  await markRead(db(), 'alice', [{ key: later, version: items[0].version }]);
  expect(await unreadCount(db(), 'alice')).toBe(2);
  expect((await page()).find((item) => item.key === 'likes:p')?.unread).toBe(
    true,
  );

  // Unliking removes only that source; a later like starts a fresh group.
  await runtime.db
    .prepare("DELETE FROM post_like WHERE post_id='p' AND user_id='david'")
    .run();
  expect((await page()).map((item) => item.key)).toEqual([
    'comment:comment-1',
    'likes:p',
  ]);
  await like(runtime.db, 'p', 'david', 1400);
  await like(runtime.db, 'q', 'bob', 1500);
  await like(runtime.db, 'q', 'carol', 1600);
  items = await page();
  expect(items).toMatchObject([
    { key: 'likes:q', count: 2, more: false },
    { kind: 'likes', count: 1, more: true },
    { key: 'comment:comment-1' },
    { key: 'likes:p', count: 2 },
  ]);
  expect(items[1].key).not.toBe(later);

  // An earlier group hidden by blocks no longer makes the later one "more".
  await runtime.db.batch([
    runtime.db.prepare("INSERT INTO block VALUES('alice','bob',1)"),
    runtime.db.prepare("INSERT INTO block VALUES('alice','carol',1)"),
  ]);
  expect(await page()).toMatchObject([{ kind: 'likes', more: false }]);
});

it('keeps a group for timestamp updates and regroups a like moved to another post', async () => {
  await photo(runtime.db, 'p');
  await photo(runtime.db, 'q');
  await like(runtime.db, 'p', 'bob', 1000);
  await like(runtime.db, 'p', 'carol', 1100);
  await runtime.db
    .prepare("UPDATE post_like SET created_at=1050 WHERE user_id='carol'")
    .run();
  expect(await page()).toMatchObject([
    { key: 'likes:p', count: 2, unread: true },
  ]);
  await runtime.db
    .prepare("UPDATE post_like SET post_id='q' WHERE user_id='carol'")
    .run();
  expect(await page()).toMatchObject([
    { key: 'likes:q', count: 1 },
    { key: 'likes:p', count: 1 },
  ]);
});

it('stops like alerts and keeps existing groups and receipts through migration 0029', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 28);
  try {
    await profiles(old);
    await photo(old.db, 'p');
    await old.db.batch([
      old.db.prepare('DELETE FROM follow'),
      old.db.prepare(
        "INSERT INTO push_subscription VALUES('device','alice','alice','https://fcm.googleapis.com/synthetic','key','auth',1)",
      ),
      old.db.prepare(
        "INSERT INTO follow VALUES('david','alice','pending',900)",
      ),
    ]);
    await like(old.db, 'p', 'bob', 1000);
    await like(old.db, 'p', 'carol', 1100);
    await old.db
      .prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE event_key='likes:p' AND actor_id='bob'",
      )
      .run();
    const keys = async () =>
      (
        await old.db
          .prepare('SELECT event_key FROM push_delivery ORDER BY event_key')
          .all<{ event_key: string }>()
      ).results.map((row) => row.event_key);
    expect(await keys()).toEqual(['likes:p', 'request:david']);
    const snapshot = async () =>
      Promise.all(
        ['activity_source', 'activity_read_state'].map(
          async (table) =>
            (
              await old.db
                .prepare(`SELECT * FROM ${table} ORDER BY 1,2,3`)
                .all()
            ).results,
        ),
      );
    const before = await snapshot();
    await old.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0029_like_runs.sql', 'utf8'),
      ).map((query) => old.db.prepare(query)),
    );
    expect(await keys()).toEqual(['request:david']);
    expect(await snapshot()).toEqual(before);
    await like(old.db, 'p', 'david', 1200);
    expect(
      await old.db
        .prepare(
          "SELECT COUNT(*) n FROM activity_source WHERE event_key='likes:p'",
        )
        .first('n'),
    ).toBe(3);
    expect(await keys()).toEqual(['request:david']);
    await old.db
      .prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('c','p','bob','Hi',1300)",
      )
      .run();
    expect(await keys()).toEqual(['comment:c', 'request:david']);
    await old.db.prepare("DELETE FROM post_like WHERE user_id='carol'").run();
    expect(
      await old.db
        .prepare(
          "SELECT COUNT(*) n FROM activity_source WHERE event_key='likes:p'",
        )
        .first('n'),
    ).toBe(2);
    expect(
      (await old.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await old.worker.dispose();
  }
});

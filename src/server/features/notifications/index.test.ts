import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from '../../../../tests/support/runtime';
import { markRead, notificationPage, unreadCount } from './index';
import {
  emptyMetrics,
  measuredDatabase,
  requestMetrics,
} from '../../telemetry';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
  for (const id of ['alice', 'bob', 'carol']) {
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  }
});
afterAll(async () => {
  await runtime?.worker.dispose();
});

beforeEach(async () => {
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM notification_read'),
    runtime.db.prepare('DELETE FROM comment'),
    runtime.db.prepare('DELETE FROM post_like'),
    runtime.db.prepare('DELETE FROM post'),
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare('DELETE FROM block'),
    runtime.db.prepare("UPDATE membership SET status='active'"),
  ]);
});
it('measures Activity database work for a fixed page size as history grows', async () => {
  const db = measuredDatabase(runtime.db as unknown as D1Database);
  const measurements: {
    historyPosts: number;
    itemsReturned: number;
    pageRowsRead: number;
    acknowledgementRowsRead: number;
    countRowsRead: number;
  }[] = [];
  for (const size of [30, 3000]) {
    await runtime.db.batch([
      runtime.db.prepare('DELETE FROM notification_read'),
      runtime.db.prepare('DELETE FROM comment'),
      runtime.db.prepare('DELETE FROM post_like'),
      runtime.db.prepare('DELETE FROM post'),
      runtime.db
        .prepare(
          `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height)
        SELECT 'history-'||n,'alice','','',n,n,'published','posts/history-'||n,1,1 FROM seq`,
        )
        .bind(size),
      runtime.db.prepare(
        "INSERT INTO post_like(post_id,user_id,created_at) SELECT id,'bob',created_at FROM post",
      ),
      runtime.db.prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) SELECT 'comment-'||id,id,'bob','Test',created_at FROM post",
      ),
    ]);
    const pageMetrics = emptyMetrics();
    const page = await requestMetrics.run(pageMetrics, () =>
      notificationPage(db, 'alice', null),
    );
    expect(page.items).toHaveLength(20);
    expect(pageMetrics.rowsWritten).toBe(0);
    const receiptMetrics = emptyMetrics();
    await requestMetrics.run(receiptMetrics, () =>
      markRead(db, 'alice', page.items),
    );
    expect(await unreadCount(db, 'alice')).toBe(Math.min(100, size * 2 - 20));
    // A long read history must not make the periodic badge check expensive.
    await runtime.db.prepare('UPDATE activity_read_state SET is_read=1').run();
    await runtime.db
      .prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('latest','history-1','bob','Newest',9999)",
      )
      .run();
    const countMetrics = emptyMetrics();
    expect(
      await requestMetrics.run(countMetrics, () => unreadCount(db, 'alice')),
    ).toBe(1);
    measurements.push({
      historyPosts: size,
      itemsReturned: page.items.length,
      pageRowsRead: pageMetrics.rowsRead,
      acknowledgementRowsRead: receiptMetrics.rowsRead,
      countRowsRead: countMetrics.rowsRead,
    });
  }
  for (const metrics of measurements) {
    expect(metrics.pageRowsRead).toBeLessThan(600);
    expect(metrics.acknowledgementRowsRead).toBeLessThan(1200);
    expect(metrics.countRowsRead).toBeLessThan(50);
  }
  expect(measurements[1].pageRowsRead).toBeLessThan(
    measurements[0].pageRowsRead * 2,
  );
  expect(measurements[1].acknowledgementRowsRead).toBeLessThan(
    measurements[0].acknowledgementRowsRead * 2,
  );
  expect(measurements[1].countRowsRead).toBeLessThan(
    measurements[0].countRowsRead * 2,
  );
});

async function photo(id: string) {
  await runtime.db
    .prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,'alice','','',1,1,'published',?,1,1)",
    )
    .bind(id, `posts/${id}`)
    .run();
}
it('keeps grouped-like ordering and counts correct after blocks, inactivity, updates and unlikes', async () => {
  await photo('one');
  await photo('two');
  const db = runtime.db as unknown as D1Database;
  const page = () => notificationPage(db, 'alice', null);
  await db.batch([
    db.prepare("INSERT INTO post_like VALUES('one','bob',1000)"),
    db.prepare("INSERT INTO post_like VALUES('one','carol',2000)"),
    db.prepare("INSERT INTO post_like VALUES('two','bob',1500)"),
  ]);
  expect(
    (await page()).items.map(({ key, count, createdAt }) => [
      key,
      count,
      createdAt,
    ]),
  ).toEqual([
    ['likes:one', 2, 2000],
    ['likes:two', 1, 1500],
  ]);
  await db.prepare("INSERT INTO block VALUES('carol','alice',1)").run();
  const blocked = await page();
  expect(
    blocked.items.map(({ key, count, createdAt }) => [key, count, createdAt]),
  ).toEqual([
    ['likes:two', 1, 1500],
    ['likes:one', 1, 1000],
  ]);
  await db.prepare('DELETE FROM block').run();
  expect((await page()).items.map((item) => item.key)).toEqual([
    'likes:one',
    'likes:two',
  ]);
  await db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='carol'")
    .run();
  expect((await page()).items.map((item) => item.key)).toEqual([
    'likes:two',
    'likes:one',
  ]);
  await db
    .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
    .run();
  await db
    .prepare("UPDATE post_like SET created_at=1500 WHERE user_id='carol'")
    .run();
  await db
    .prepare(
      "UPDATE post_like SET created_at=1500 WHERE user_id='bob' AND post_id='one'",
    )
    .run();
  expect((await page()).items).toHaveLength(2); // Timestamp ties do not duplicate the group.
  await db.prepare("DELETE FROM post_like WHERE user_id='carol'").run();
  expect(
    (await page()).items.find((item) => item.key === 'likes:one')?.count,
  ).toBe(1);
});
it('rolls back the originating interaction if its activity index cannot be maintained', async () => {
  await photo('atomic');
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_activity BEFORE INSERT ON activity_source BEGIN SELECT RAISE(ABORT,'synthetic_index_failure'); END",
    )
    .run();
  try {
    await expect(
      runtime.db
        .prepare("INSERT INTO post_like VALUES('atomic','bob',1)")
        .run(),
    ).rejects.toThrow();
    expect(
      await runtime.db
        .prepare("SELECT 1 FROM post_like WHERE post_id='atomic'")
        .first(),
    ).toBeNull();
  } finally {
    await runtime.db.prepare('DROP TRIGGER fail_activity').run();
  }
});

it('backfills existing interactions and continues indexing mutations from the previous application', async () => {
  await photo('existing');
  await runtime.db.batch([
    runtime.db.prepare("INSERT INTO post_like VALUES('existing','bob',1000)"),
    runtime.db.prepare(
      "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('old-comment','existing','carol','Existing',2000)",
    ),
    runtime.db.prepare(
      "INSERT INTO follow VALUES('bob','alice','pending',3000)",
    ),
  ]);
  const db = runtime.db as unknown as D1Database;
  const before = await notificationPage(db, 'alice', null);
  expect(before.items).toHaveLength(3);
  // Recreate the pre-migration state, then run the exact production migration.
  const drop = ['follow', 'post_like', 'comment'].flatMap((table) =>
    ['insert', 'update', 'delete'].map(
      (action) => `DROP TRIGGER activity_${table}_${action}`,
    ),
  );
  await runtime.db.batch(
    [
      ...drop,
      'DROP TABLE activity_read_state',
      'DROP TABLE activity_source',
      ...unstable_splitSqlQuery(
        readFileSync('migrations/0017_activity_sources.sql', 'utf8'),
      ),
      ...unstable_splitSqlQuery(
        readFileSync('migrations/0018_activity_read_state.sql', 'utf8'),
      ),
      ...unstable_splitSqlQuery(
        readFileSync('migrations/0026_follow_back_dismissal.sql', 'utf8'),
      ),
    ].map((sql) => runtime.db.prepare(sql)),
  );
  expect(await notificationPage(db, 'alice', null)).toMatchObject({
    items: before.items.map((item) => ({
      key: item.key,
      kind: item.kind,
      count: item.count,
      createdAt: item.createdAt,
      unread: true,
    })),
  });
  await runtime.db
    .prepare(
      "UPDATE follow SET status='accepted' WHERE follower_id='bob' AND target_id='alice'",
    )
    .run();
  await runtime.db
    .prepare(
      "UPDATE comment SET body='',deleted_at=4000 WHERE id='old-comment'",
    )
    .run();
  await runtime.db
    .prepare("DELETE FROM post_like WHERE post_id='existing'")
    .run();
  expect((await notificationPage(db, 'alice', null)).items).toEqual([]);
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM activity_source')
      .first('count'),
  ).toBe(0);
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM activity_read_state')
      .first('count'),
  ).toBe(0);
});

it('never acknowledges newer activity through a delayed receipt, including timestamp ties and recreated requests', async () => {
  await photo('versions');
  const db = runtime.db as unknown as D1Database;
  await db.prepare("INSERT INTO post_like VALUES('versions','bob',1000)").run();
  const old = (await notificationPage(db, 'alice', null)).items;
  await db
    .prepare("INSERT INTO post_like VALUES('versions','carol',1000)")
    .run();
  await markRead(db, 'alice', old);
  expect(await unreadCount(db, 'alice')).toBe(1);
  const latest = (await notificationPage(db, 'alice', null)).items;
  expect(latest[0]).toMatchObject({ count: 2, unread: true });
  expect(latest[0].version).toBeGreaterThan(old[0].version);
  await Promise.all([
    markRead(db, 'alice', latest),
    markRead(db, 'alice', latest),
  ]);
  expect(await unreadCount(db, 'alice')).toBe(0);
  await db
    .prepare("INSERT INTO follow VALUES('bob','alice','pending',1000)")
    .run();
  const first = (await notificationPage(db, 'alice', null)).items.filter(
    (item) => item.kind === 'request',
  );
  await db
    .prepare("DELETE FROM follow WHERE follower_id='bob' AND target_id='alice'")
    .run();
  await db
    .prepare("INSERT INTO follow VALUES('bob','alice','pending',1000)")
    .run();
  await markRead(db, 'alice', first);
  expect(await unreadCount(db, 'alice')).toBe(1);
  expect(
    (await notificationPage(db, 'alice', null)).items.find(
      (item) => item.kind === 'request',
    )!.version,
  ).toBeGreaterThan(first[0].version);
});

it('uses current visibility for badge counts and receipts and cleans up deleted sources', async () => {
  await photo('privacy');
  const db = runtime.db as unknown as D1Database;
  await db.prepare("INSERT INTO post_like VALUES('privacy','bob',1000)").run();
  await markRead(
    db,
    'alice',
    (await notificationPage(db, 'alice', null)).items,
  );
  await db
    .prepare("INSERT INTO post_like VALUES('privacy','carol',2000)")
    .run();
  const beforeBlock = (await notificationPage(db, 'alice', null)).items;
  await db.prepare("INSERT INTO block VALUES('carol','alice',1)").run();
  expect(await unreadCount(db, 'alice')).toBe(0);
  expect((await notificationPage(db, 'alice', null)).items[0]).toMatchObject({
    count: 1,
    unread: false,
  });
  await markRead(db, 'alice', beforeBlock);
  await db.prepare('DELETE FROM block').run();
  expect(await unreadCount(db, 'alice')).toBe(1);
  await db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='carol'")
    .run();
  expect(await unreadCount(db, 'alice')).toBe(0);
  await markRead(db, 'alice', beforeBlock);
  await db
    .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
    .run();
  expect(await unreadCount(db, 'alice')).toBe(1);
  await db.prepare("UPDATE post SET state='deleted' WHERE id='privacy'").run();
  expect(await unreadCount(db, 'alice')).toBe(0);
  await markRead(db, 'alice', beforeBlock);
  expect(
    await db
      .prepare("SELECT is_read FROM activity_read_state WHERE actor_id='carol'")
      .first('is_read'),
  ).toBe(0);
  await db.prepare("DELETE FROM post_like WHERE post_id='privacy'").run();
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM activity_read_state')
      .first('count'),
  ).toBe(0);
});

it('backfills old read markers once and creates new versions atomically for old application writes', async () => {
  await photo('backfill');
  const db = runtime.db as unknown as D1Database;
  await db.prepare("INSERT INTO post_like VALUES('backfill','bob',1000)").run();
  await db
    .prepare(
      "INSERT INTO notification_read VALUES('alice','likes:backfill',1000)",
    )
    .run();
  await db.batch(
    [
      'DROP TRIGGER activity_receipt_insert',
      'DROP TRIGGER activity_receipt_update',
      'DROP TRIGGER activity_receipt_updated',
      'DROP TABLE activity_read_state',
      ...unstable_splitSqlQuery(
        readFileSync('migrations/0018_activity_read_state.sql', 'utf8'),
      ),
      ...unstable_splitSqlQuery(
        readFileSync('migrations/0026_follow_back_dismissal.sql', 'utf8'),
      ),
    ].map((sql) => db.prepare(sql)),
  );
  expect(await unreadCount(db, 'alice')).toBe(0);
  await db
    .prepare("INSERT INTO post_like VALUES('backfill','carol',1000)")
    .run();
  expect(await unreadCount(db, 'alice')).toBe(1);
  await db
    .prepare(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON activity_read_state BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END",
    )
    .run();
  try {
    await expect(
      db
        .prepare("INSERT INTO follow VALUES('bob','alice','pending',2000)")
        .run(),
    ).rejects.toThrow();
    expect(
      await db.prepare("SELECT 1 FROM follow WHERE follower_id='bob'").first(),
    ).toBeNull();
  } finally {
    await db.prepare('DROP TRIGGER fail_receipt').run();
  }
});

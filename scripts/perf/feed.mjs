// Synthetic, disposable D1 benchmark. Never loads app credentials or production data.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const compiled = await build({
  stdin: {
    contents: `export { listPosts } from './src/server/features/posts/index.ts'; export { notificationPage } from './src/server/features/notifications/index.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { listPosts, notificationPage } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script:
      'export default { fetch() { return new Response("Synthetic benchmark"); } };',
    compatibilityDate: '2026-10-10',
    d1Databases: ['DB'],
    outboundService: async () => {
      throw new Error('Network disabled in benchmark');
    },
  }),
);
try {
  const db = await worker.getD1Database('DB');
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map(
        (sql) => db.prepare(sql),
      ),
    );
  }
  // Skip irrelevant relationship side effects while seeding synthetic identities.
  await db.prepare('DROP TRIGGER profile_invitation_follows').run();
  const authorCount = Number(process.argv[2] ?? 10000);
  const perAuthor = Number(process.argv[3] ?? 100);
  assert(
    Number.isInteger(authorCount) &&
      authorCount >= 1000 &&
      authorCount <= 20000,
  );
  assert(Number.isInteger(perAuthor) && perAuthor >= 1 && perAuthor <= 1000);
  const total = authorCount * perAuthor;
  assert(total <= 2000000);
  const sequence = (n) =>
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${n})`;
  await db
    .prepare(
      `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('viewer','Viewer','viewer@example.invalid',1,0,0)`,
    )
    .run();
  await db
    .prepare(`INSERT INTO membership(user_id,joined_at) VALUES('viewer',0)`)
    .run();
  await db
    .prepare(
      `${sequence(authorCount)} INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) SELECT 'u'||n,'Person '||n,'person'||n||'@example.invalid',1,0,0 FROM seq`,
    )
    .run();
  await db
    .prepare(
      `${sequence(authorCount)} INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) SELECT 'i'||n,'viewer','person'||n||'@example.invalid',0,9999999999999 FROM seq`,
    )
    .run();
  await db
    .prepare(
      `${sequence(authorCount)} INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) SELECT 'u'||n,'viewer','i'||n,0 FROM seq`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO profile(user_id,handle,display_name,created_at) SELECT id,CASE WHEN id='viewer' THEN 'viewer' ELSE 'member'||substr(id,2) END,name,0 FROM user`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO avatar(user_id,object_key,width,height) SELECT user_id,'avatar/'||user_id,320,320 FROM profile`,
    )
    .run();
  // Give every author 50 follows so plans must handle a site-wide social graph.
  await db
    .prepare(
      `${sequence(50)} INSERT INTO follow(follower_id,target_id,status,created_at)
       SELECT u.id,'u'||(1+(CAST(substr(u.id,2) AS INTEGER)+seq.n-1)%${authorCount}),'accepted',0
       FROM user u CROSS JOIN seq WHERE u.id!='viewer'`,
    )
    .run();
  await db
    .prepare(
      `${sequence(total)} INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) SELECT printf('%036d',n),'u'||(1+(n-1)%${authorCount}),'Synthetic caption','',n,n,'published','photo/'||n,1200,800 FROM seq`,
    )
    .run();
  // Two likes and one comment per photo keep engagement work realistic and deterministic.
  await db
    .prepare(
      `INSERT INTO post_like(post_id,user_id,created_at) SELECT id,'viewer',published_at FROM post`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO post_like(post_id,user_id,created_at) SELECT id,CASE WHEN user_id='u1' THEN 'u2' ELSE 'u1' END,published_at FROM post`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO comment(id,post_id,user_id,body,created_at) SELECT 'c'||id,id,user_id,'Synthetic comment',published_at FROM post`,
    )
    .run();
  console.error(
    `Seeded ${authorCount} authors, ${total} photos, ${2 * total} likes, ${total} comments.`,
  );
  // Capture the current implementation's SQL without copying it into this benchmark.
  let current;
  const recording = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              current = { sql, params };
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const cursor = { snapshot: total, before: total + 1, id: '' };
  const historical = JSON.parse(
    await readFile('scripts/perf/baseline-2026-10-11.json', 'utf8'),
  );
  const oldQuery = (handle, pageCursor) => ({
    sql: historical[handle ? 'profile' : 'feed'],
    params: [
      'viewer',
      pageCursor.snapshot,
      ...(handle ? [handle] : []),
      pageCursor.before,
      pageCursor.before,
      pageCursor.id,
    ],
  });
  const comparable = (items) =>
    items.map((item) => {
      const copy = { ...item };
      delete copy.thumbnailKey;
      return copy;
    });
  async function measure(query) {
    const stmt = db.prepare(query.sql).bind(...query.params);
    const samples = [];
    let output;
    for (let i = 0; i < 4; i++) {
      const start = performance.now();
      output = await stmt.all();
      if (i > 0)
        samples.push({
          ms: performance.now() - start,
          sqlMs: output.meta.duration,
          rowsRead: output.meta.rows_read,
        });
    }
    samples.sort((a, b) => a.ms - b.ms);
    return {
      median: samples[1],
      items: output.results,
      plan: (
        await db
          .prepare('EXPLAIN QUERY PLAN ' + query.sql)
          .bind(...query.params)
          .all()
      ).results.map((r) => r.detail),
    };
  }
  const results = [];
  for (const analyzed of [false, true]) {
    if (analyzed) await db.prepare('ANALYZE').run();
    for (const follows of [0, 50, 500]) {
      await db.prepare("DELETE FROM follow WHERE follower_id='viewer'").run();
      if (follows)
        await db
          .prepare(
            `${sequence(follows)} INSERT INTO follow(follower_id,target_id,status,created_at) SELECT 'viewer','u'||n,'accepted',0 FROM seq`,
          )
          .run();
      for (const depth of ['newest', 'older']) {
        const pageCursor = {
          ...cursor,
          before: depth === 'older' ? Math.floor(total / 2) : cursor.before,
        };
        await listPosts(recording, 'viewer', null, pageCursor);
        const baseline = await measure(oldQuery(null, pageCursor));
        const bounded = await measure(current);
        assert.deepEqual(
          comparable(bounded.items),
          baseline.items,
          'Optimized query changed the feed',
        );
        const record = {
          authors: authorCount,
          photos: total,
          follows,
          analyzed,
          depth,
          returned: baseline.items.length,
          baseline: baseline.median,
          bounded: bounded.median,
        };
        results.push(record);
        console.error(JSON.stringify(record));
        if (follows === 50 && depth === 'newest')
          results.push({
            analyzed,
            baselinePlan: baseline.plan,
            boundedPlan: bounded.plan,
          });
      }
    }
  }
  // Adjacent read paths: profile grid and an empty Activity page on the same large database.
  for (const handle of ['member1', 'member500']) {
    await listPosts(recording, 'viewer', handle, cursor);
    const profile = await measure(current);
    const baseline = await measure(oldQuery(handle, cursor));
    assert.deepEqual(
      comparable(profile.items),
      baseline.items,
      'Optimized query changed profile posts',
    );
    results.push({
      profile: handle,
      baseline: baseline.median,
      optimized: profile.median,
      plan: profile.plan,
    });
  }
  await notificationPage(recording, 'viewer', null);
  const activity = await measure(current);
  results.push({
    activity: 'empty page',
    measurement: activity.median,
    returned: activity.items.length,
    plan: activity.plan,
  });
  console.log(
    JSON.stringify(
      {
        runtime:
          'local Miniflare D1; synthetic data; median of 3 warmed runs after one warmup; excludes HTTP/auth/R2',
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await worker.dispose();
}

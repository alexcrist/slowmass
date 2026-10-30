import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from './support/runtime';

// Temporary: protects migration 0041 until production applies it.
it('rebuilds activity kinds for comment activity while preserving receipts and queued email', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 40);
  const { db } = runtime;
  const rows = async (sql: string) => (await db.prepare(sql).all()).results;
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO profile(user_id,handle,display_name,created_at) SELECT user_id,user_id,user_id,1 FROM membership WHERE 1 ON CONFLICT DO NOTHING',
      ),
      db.prepare('DELETE FROM follow'),
      db.prepare(
        "INSERT INTO follow(follower_id,target_id,status,created_at) VALUES('bob','alice','pending',1),('carol','alice','pending',2)",
      ),
      db.prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE event_key='request:carol'",
      ),
      db.prepare(
        "INSERT INTO email_delivery(recipient_id,event_key,version,created_at,available_at) SELECT recipient_id,event_key,revision,3,3 FROM activity_read_state WHERE event_key='request:bob'",
      ),
      db.prepare(
        "INSERT INTO email_delivery(recipient_id,event_key,version,created_at,available_at) VALUES('alice','event_message:copy',NULL,4,4)",
      ),
    ]);
    await db
      .prepare(
        `INSERT INTO push_subscription(id,user_id,session_id,endpoint,p256dh,auth,created_at)
      SELECT 'old-device','alice',id,'https://web.push.apple.com/old','key','auth',1 FROM session WHERE userId='alice' LIMIT 1`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO push_delivery(subscription_id,event_key,version,created_at,available_at,attempts,lease,lease_until)
      SELECT 'old-device',event_key,revision,3,4,2,'existing-lease',9 FROM activity_read_state WHERE event_key='request:bob'`,
      )
      .run();
    const sources = await rows(
      'SELECT * FROM activity_source ORDER BY event_key',
    );
    const push = await rows('SELECT * FROM push_delivery ORDER BY event_key');
    const receipts = await rows(
      'SELECT * FROM activity_read_state ORDER BY revision',
    );
    const email = await rows('SELECT * FROM email_delivery ORDER BY event_key');
    const sequence = await db
      .prepare(
        "SELECT seq FROM sqlite_sequence WHERE name='activity_read_state'",
      )
      .first<number>('seq');
    const migration = unstable_splitSqlQuery(
      readFileSync('migrations/0041_comment_activity.sql', 'utf8'),
    ).map((sql) => db.prepare(sql));
    await expect(
      db.batch([
        ...migration,
        db.prepare('INSERT INTO deliberately_missing_table VALUES(1)'),
      ]),
    ).rejects.toThrow();
    expect(
      await rows('SELECT * FROM activity_source ORDER BY event_key'),
    ).toEqual(sources);
    expect(
      await rows('SELECT * FROM push_delivery ORDER BY event_key'),
    ).toEqual(push);
    await db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0041_comment_activity.sql', 'utf8'),
      ).map((sql) => db.prepare(sql)),
    );
    expect(
      await rows('SELECT * FROM activity_read_state ORDER BY revision'),
    ).toEqual(receipts);
    expect(
      await rows('SELECT * FROM email_delivery ORDER BY event_key'),
    ).toEqual(email);
    expect((await rows('PRAGMA foreign_key_check')).length).toBe(0);
    expect(
      await rows('SELECT * FROM activity_source ORDER BY event_key'),
    ).toEqual(sources);
    expect(
      await rows('SELECT * FROM push_delivery ORDER BY event_key'),
    ).toEqual(push);
    // Existing triggers still write activity, continuing the receipt sequence.
    await db
      .prepare(
        "INSERT INTO follow(follower_id,target_id,status,created_at) VALUES('david','alice','pending',5)",
      )
      .run();
    expect(
      await db
        .prepare(
          "SELECT revision FROM activity_read_state WHERE event_key='request:david'",
        )
        .first<number>('revision'),
    ).toBeGreaterThan(sequence!);
    // Publishing with the default preference writes no post alert.
    await db.batch([
      db.prepare("UPDATE follow SET status='accepted' WHERE follower_id='bob'"),
      db.prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,state) VALUES('photo','alice','','',1,'processing')",
      ),
      db.prepare(
        "UPDATE post SET state='published',object_key='posts/photo',width=1,height=1,published_at=6 WHERE id='photo'",
      ),
    ]);
    expect(
      await rows("SELECT * FROM activity_source WHERE kind='post'"),
    ).toEqual([]);
    // Previous-Worker mutations still work. New sources use NULL post_id so
    // its owned-photo fallback cannot accept an unknown kind.
    await db.batch([
      db.prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('11111111-1111-4111-8111-111111111111','photo','alice','Owner',7)",
      ),
      db.prepare(
        "INSERT INTO comment_like VALUES('11111111-1111-4111-8111-111111111111','bob',8)",
      ),
    ]);
    expect(
      await rows(
        "SELECT kind,post_id FROM activity_source WHERE kind='comment_like'",
      ),
    ).toEqual([{ kind: 'comment_like', post_id: null }]);
    expect(
      await rows(
        "SELECT e.kind FROM activity_source e WHERE e.kind='comment_like' AND EXISTS(SELECT 1 FROM post p WHERE p.id=e.post_id AND p.user_id=e.recipient_id AND p.state='published')",
      ),
    ).toEqual([]);
  } finally {
    await runtime.worker.dispose();
  }
});

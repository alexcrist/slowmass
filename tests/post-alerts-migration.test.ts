import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from './support/runtime';

// Temporary: protects migration 0039 until production applies it.
it('rebuilds activity kinds for post alerts while preserving receipts and queued email', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 38);
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
    const receipts = await rows(
      'SELECT * FROM activity_read_state ORDER BY revision',
    );
    const email = await rows('SELECT * FROM email_delivery ORDER BY event_key');
    const sequence = await db
      .prepare(
        "SELECT seq FROM sqlite_sequence WHERE name='activity_read_state'",
      )
      .first<number>('seq');
    await db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0039_post_alerts.sql', 'utf8'),
      ).map((sql) => db.prepare(sql)),
    );
    expect(
      await rows('SELECT * FROM activity_read_state ORDER BY revision'),
    ).toEqual(receipts);
    expect(
      await rows('SELECT * FROM email_delivery ORDER BY event_key'),
    ).toEqual(email);
    expect((await rows('PRAGMA foreign_key_check')).length).toBe(0);
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
  } finally {
    await runtime.worker.dispose();
  }
});

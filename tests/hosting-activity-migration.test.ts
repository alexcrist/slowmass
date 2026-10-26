import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from './support/runtime';

// Temporary: protects migration 0038 until production applies it.
it('rebuilds activity kinds while preserving receipts, queued email and the previous Worker', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 37);
  const { db } = runtime;
  const rows = async (sql: string) => (await db.prepare(sql).all()).results;
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO profile(user_id,handle,display_name,created_at) SELECT user_id,user_id,user_id,1 FROM membership WHERE 1 ON CONFLICT DO NOTHING',
      ),
      // Profiles start invitation follows; begin without relationships.
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
      // A host's copy of an update blast has no version.
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
        readFileSync('migrations/0038_hosting_activity.sql', 'utf8'),
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
    await db.prepare("DELETE FROM follow WHERE follower_id='bob'").run();
    expect(
      await rows("SELECT * FROM email_delivery WHERE event_key='request:bob'"),
    ).toEqual([]);
    // The previous Worker's host invitation writes still succeed.
    await db.batch([
      db.prepare(
        "INSERT INTO event(id,creator_id,title,starts_at,time_zone,link_id,link_hash,created_at) VALUES('party','alice','Party',9999999999999,'UTC','link','hash',1)",
      ),
      db.prepare("INSERT INTO event_host VALUES('party','alice',1)"),
      db.prepare(
        "INSERT INTO event_host_member_invite VALUES('party','bob','alice','link',6)",
      ),
      db.prepare(
        "INSERT INTO event_access(event_id,user_id,link_id,created_at) VALUES('party','bob','link',6)",
      ),
      db.prepare("INSERT INTO event_host VALUES('party','bob',7)"),
      db.prepare(
        "DELETE FROM event_host_member_invite WHERE event_id='party' AND user_id='bob'",
      ),
    ]);
    expect(
      await rows(
        "SELECT recipient_id,event_key,kind FROM activity_source WHERE kind LIKE 'host_%' ORDER BY kind",
      ),
    ).toEqual([
      {
        recipient_id: 'alice',
        event_key: 'host_accepted:party.bob',
        kind: 'host_accepted',
      },
      {
        recipient_id: 'bob',
        event_key: 'host_invite:party',
        kind: 'host_invite',
      },
    ]);
  } finally {
    await runtime.worker.dispose();
  }
});

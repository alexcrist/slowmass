import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime } from './support/runtime';

it('adds member invitations while preserving previous host reads and writes', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 34);
  try {
    await runtime.db
      .prepare(
        "INSERT INTO event(id,creator_id,title,starts_at,time_zone,link_id,link_hash,created_at) VALUES('party','alice','Party',9999999999999,'UTC','link','hash',1)",
      )
      .run();
    await runtime.db
      .prepare("INSERT INTO event_host VALUES('party','alice',1)")
      .run();
    await runtime.db
      .prepare(
        "INSERT INTO event_host_invite VALUES('party','bob@example.com',1)",
      )
      .run();
    const before = await runtime.db
      .prepare('SELECT * FROM membership ORDER BY user_id')
      .all();
    await runtime.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0035_event_host_members.sql', 'utf8'),
      ).map((sql) => runtime.db.prepare(sql)),
    );
    expect(
      await runtime.db
        .prepare('SELECT * FROM membership ORDER BY user_id')
        .all(),
    ).toMatchObject({ results: before.results });
    expect(
      await runtime.db
        .prepare("SELECT email FROM event_host_invite WHERE event_id='party'")
        .first('email'),
    ).toBe('bob@example.com');
    // Explicit queries used by the previous Worker remain valid after expansion.
    await runtime.db
      .prepare(
        "INSERT INTO event_host_invite VALUES('party','carol@example.com',2)",
      )
      .run();
    await runtime.db
      .prepare("INSERT INTO event_host VALUES('party','bob',2)")
      .run();
    await runtime.db
      .prepare("DELETE FROM event_host_invite WHERE email='bob@example.com'")
      .run();
    expect(
      await runtime.db
        .prepare('SELECT COUNT(*) AS n FROM event_host')
        .first('n'),
    ).toBe(2);
    await runtime.db
      .prepare(
        "INSERT INTO event_host_member_invite VALUES('party','carol','alice','link',3)",
      )
      .run();
    expect(
      (await runtime.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await runtime.worker.dispose();
  }
});

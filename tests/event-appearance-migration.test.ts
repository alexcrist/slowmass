import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';

it('adds appearance defaults without changing existing data or the previous Worker’s event writes', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 32);
  try {
    await runtime.request('alice', '/api/people/self', 'PUT', {
      handle: 'alice',
      displayName: 'Alice',
      bio: '',
    });
    await seedProfilePhotos(runtime.db);
    const id = crypto.randomUUID();
    const details = {
      id,
      title: 'Dinner',
      description: 'Bring a dish',
      location: '1 Main St',
      startsAt: Date.now() + 86400000,
      endsAt: null,
      timeZone: 'America/Los_Angeles',
    };
    // Keep the previous Worker's explicit-column writes here. Today's Worker
    // also writes appearance and requires migration 0033 before it runs.
    async function createWithPreviousColumns(eventId: string) {
      const now = Date.now();
      await runtime.db.batch([
        runtime.db
          .prepare(
            `INSERT INTO event(id,creator_id,title,description,location,starts_at,ends_at,time_zone,link_id,link_hash,link_encrypted,created_at)
          SELECT ?,m.user_id,?,?,?,?,?,?,?,?,?,? FROM membership m JOIN avatar a ON a.user_id=m.user_id
          WHERE m.user_id=? AND m.status='active'
            AND (SELECT COUNT(*) FROM event WHERE creator_id=m.user_id AND created_at>?)<10
          ON CONFLICT DO NOTHING`,
          )
          .bind(
            eventId,
            details.title,
            details.description,
            details.location,
            details.startsAt,
            details.endsAt,
            details.timeZone,
            eventId,
            `synthetic-hash-${eventId}`,
            'synthetic-ciphertext',
            now,
            'alice',
            now - 86400000,
          ),
        runtime.db
          .prepare(
            `INSERT INTO event_host(event_id,user_id,created_at)
          SELECT id,creator_id,created_at FROM event WHERE id=? AND creator_id=? AND state='pending'
          ON CONFLICT DO NOTHING`,
          )
          .bind(eventId, 'alice'),
      ]);
    }
    await createWithPreviousColumns(id);
    const before = await runtime.db
      .prepare('SELECT * FROM event WHERE id=?')
      .bind(id)
      .first();
    const hosts = (await runtime.db.prepare('SELECT * FROM event_host').all())
      .results;
    await runtime.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0033_event_appearance.sql', 'utf8'),
      ).map((sql) => runtime.db.prepare(sql)),
    );
    expect(
      await runtime.db
        .prepare('SELECT * FROM event WHERE id=?')
        .bind(id)
        .first(),
    ).toEqual({ ...before, color_theme: 'original', font_pairing: 'original' });
    expect(
      (await runtime.db.prepare('SELECT * FROM event_host').all()).results,
    ).toEqual(hosts);
    // The previous Worker uses explicit-column inserts and these same detail
    // writes. Both remain valid if migration succeeds but deployment fails.
    await createWithPreviousColumns(id);
    const nextId = crypto.randomUUID();
    await createWithPreviousColumns(nextId);
    await runtime.db
      .prepare('UPDATE event SET color_theme=?,font_pairing=? WHERE id=?')
      .bind('wine', 'classic', id)
      .run();
    await runtime.db
      .prepare(
        'UPDATE event SET title=?,description=?,location=?,starts_at=?,ends_at=?,time_zone=? WHERE id=?',
      )
      .bind(
        'Lunch',
        details.description,
        details.location,
        details.startsAt,
        null,
        details.timeZone,
        id,
      )
      .run();
    expect(
      await runtime.db
        .prepare('SELECT title,color_theme,font_pairing FROM event WHERE id=?')
        .bind(id)
        .first(),
    ).toEqual({ title: 'Lunch', color_theme: 'wine', font_pairing: 'classic' });
    expect(
      await runtime.db
        .prepare('SELECT color_theme,font_pairing FROM event WHERE id=?')
        .bind(nextId)
        .first(),
    ).toEqual({ color_theme: 'original', font_pairing: 'original' });
    expect(
      (await runtime.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await runtime.worker.dispose();
  }
});

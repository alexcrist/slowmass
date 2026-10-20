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
    // uses the current font catalog and requires migration 0034 before it runs.
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

it('adds the party catalog without changing old rows or breaking previous-Worker appearance writes', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 33);
  try {
    const id = crypto.randomUUID();
    // The previous Worker explicitly inserts these columns; the old font
    // constraint must continue to accept all of its choices after migration.
    async function previousCreate(eventId: string, font: string) {
      await runtime.db
        .prepare(
          `INSERT INTO event
        (id,creator_id,title,description,location,starts_at,ends_at,time_zone,color_theme,font_pairing,link_id,link_hash,link_encrypted,created_at)
        VALUES (?,'alice','Dinner','Bring a dish','1 Main St',?,NULL,'UTC','wine',?,?,?,'synthetic-ciphertext',?)`,
        )
        .bind(
          eventId,
          Date.now() + 86400000,
          font,
          eventId,
          `synthetic-${eventId}`,
          Date.now(),
        )
        .run();
      await runtime.db
        .prepare(
          "INSERT INTO event_host(event_id,user_id,created_at) VALUES (?,'alice',?)",
        )
        .bind(eventId, Date.now())
        .run();
    }
    await previousCreate(id, 'poster');
    const before = await runtime.db
      .prepare('SELECT * FROM event WHERE id=?')
      .bind(id)
      .first();
    const hosts = (await runtime.db.prepare('SELECT * FROM event_host').all())
      .results;
    await runtime.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0034_event_party_fonts.sql', 'utf8'),
      ).map((sql) => runtime.db.prepare(sql)),
    );
    expect(
      await runtime.db
        .prepare('SELECT * FROM event WHERE id=?')
        .bind(id)
        .first(),
    ).toEqual({ ...before, font_pairing_v2: null });
    expect(
      (await runtime.db.prepare('SELECT * FROM event_host').all()).results,
    ).toEqual(hosts);
    for (const font of [
      'original',
      'handwritten',
      'classic',
      'poster',
      'rounded',
      'geometric',
    ]) {
      const nextId = crypto.randomUUID();
      await previousCreate(nextId, font);
      expect(
        await runtime.db
          .prepare('SELECT font_pairing,font_pairing_v2 FROM event WHERE id=?')
          .bind(nextId)
          .first(),
      ).toEqual({ font_pairing: font, font_pairing_v2: null });
    }
    // Conditional saves from the deployed Worker still compare its own IDs.
    const update = await runtime.db
      .prepare(
        "UPDATE event SET color_theme='pool',font_pairing='rounded' WHERE id=? AND color_theme='wine' AND font_pairing='poster'",
      )
      .bind(id)
      .run();
    expect(update.meta.changes).toBe(1);
    await runtime.db
      .prepare("UPDATE event SET font_pairing_v2='rubik-wet-paint' WHERE id=?")
      .bind(id)
      .run();
    // Ordinary old detail writes preserve the current font.
    await runtime.db
      .prepare("UPDATE event SET title='Lunch' WHERE id=?")
      .bind(id)
      .run();
    expect(
      await runtime.db
        .prepare('SELECT font_pairing_v2 FROM event WHERE id=?')
        .bind(id)
        .first('font_pairing_v2'),
    ).toBe('rubik-wet-paint');
    // A rollback Worker's explicit appearance choice takes precedence.
    await runtime.db
      .prepare(
        "UPDATE event SET color_theme='wine',font_pairing='classic' WHERE id=?",
      )
      .bind(id)
      .run();
    expect(
      await runtime.db
        .prepare(
          'SELECT title,color_theme,font_pairing,font_pairing_v2 FROM event WHERE id=?',
        )
        .bind(id)
        .first(),
    ).toEqual({
      title: 'Lunch',
      color_theme: 'wine',
      font_pairing: 'classic',
      font_pairing_v2: null,
    });
    expect(
      (await runtime.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await runtime.worker.dispose();
  }
});

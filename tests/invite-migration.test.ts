import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';
it('migrates joined activity atomically without backfill or losing read versions and queued pushes', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 22);
  const db = runtime.db;
  try {
    for (const id of ['alice', 'bob', 'carol', 'david'])
      await runtime.request(id, '/api/people/self', 'PUT', {
        handle: id,
        displayName: id,
        bio: '',
      });
    await seedProfilePhotos(db);
    await db.prepare('DELETE FROM follow').run();
    await db.batch([
      db.prepare(
        "INSERT INTO push_subscription VALUES('device','alice','alice','https://fcm.googleapis.com/synthetic','key','auth',1)",
      ),
      db.prepare("INSERT INTO follow VALUES('bob','alice','pending',1000)"),
      db.prepare("UPDATE follow SET status='accepted' WHERE follower_id='bob'"),
      db.prepare(
        "UPDATE push_delivery SET attempts=2,lease='synthetic',lease_until=9000",
      ),
      db.prepare("INSERT INTO follow VALUES('carol','alice','pending',2000)"),
      db.prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE event_key='request:carol'",
      ),
      db.prepare("DELETE FROM follow WHERE follower_id='carol'"),
    ]);
    const snapshot = async () =>
      Promise.all(
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
    const before = await snapshot();
    const statements = unstable_splitSqlQuery(
      await readFile('migrations/0023_invitee_activity.sql', 'utf8'),
    );
    await expect(
      db.batch(
        [
          ...statements,
          "INSERT INTO follow VALUES('bob','alice','accepted',1)",
        ].map((sql) => db.prepare(sql)),
      ),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await db.batch(statements.map((sql) => db.prepare(sql)));
    expect(await snapshot()).toEqual(before);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    expect(
      (
        await db
          .prepare("SELECT * FROM activity_source WHERE kind='joined'")
          .all()
      ).results,
    ).toEqual([]);
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind('new', 'New', 'new@example.com', now, now),
      db
        .prepare(
          'INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) VALUES(?,?,?,?,?)',
        )
        .bind('new', 'alice', 'new@example.com', now, now + 100000),
      db
        .prepare(
          'INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES(?,?,?,?)',
        )
        .bind('new', 'alice', 'new', now),
      db
        .prepare(
          "INSERT INTO profile(user_id,handle,display_name,bio,created_at) VALUES('new','new','New','',?)",
        )
        .bind(now),
      db.prepare(
        "INSERT INTO avatar(user_id,object_key,width,height) VALUES('new','synthetic/new',1,1)",
      ),
    ]);
    const receipt = await db
      .prepare(
        "SELECT revision FROM activity_read_state WHERE event_key='joined:new'",
      )
      .first<number>('revision');
    expect(receipt).toBeGreaterThan(0);
    expect(
      await db
        .prepare(
          "SELECT version FROM push_delivery WHERE event_key='joined:new'",
        )
        .first('version'),
    ).toBe(receipt);
    // The current page reader also requires the additive follow-back column.
    const beforeDismissal = await snapshot();
    await db.batch(
      unstable_splitSqlQuery(
        await readFile('migrations/0026_follow_back_dismissal.sql', 'utf8'),
      ).map((sql) => db.prepare(sql)),
    );
    const afterDismissal = await snapshot();
    expect(afterDismissal[1]).toEqual(
      beforeDismissal[1].map((row) => ({ ...row, follow_back_dismissed: 0 })),
    );
    for (const index of [0, 2, 3])
      expect(afterDismissal[index]).toEqual(beforeDismissal[index]);
    expect(
      (
        await runtime.request(
          'alice',
          '/api/notifications?focus=joined:new&includeJoined=1',
        )
      ).status,
    ).toBe(200);
    // Failing the new notification source must roll back avatar completion too.
    await db
      .prepare(
        "CREATE TRIGGER fail_joined BEFORE INSERT ON activity_source WHEN NEW.kind='joined' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
      )
      .run();
    await db
      .prepare(
        "UPDATE membership SET join_activity_pending=1 WHERE user_id='carol'",
      )
      .run();
    await db.prepare("DELETE FROM avatar WHERE user_id='carol'").run();
    await expect(
      db
        .prepare(
          "INSERT INTO avatar(user_id,object_key,width,height) VALUES('carol','synthetic/carol',1,1)",
        )
        .run(),
    ).rejects.toThrow();
    expect(
      await db.prepare("SELECT 1 FROM avatar WHERE user_id='carol'").first(),
    ).toBeNull();
  } finally {
    await runtime.worker.dispose();
  }
});

it('removes link labels and fixes existing and future capacity without changing provenance or credentials', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 23);
  const db = runtime.db;
  try {
    await db
      .prepare(
        "INSERT INTO invite_link(id,inviter_id,name,token_hash,token_encrypted,created_at,expires_at,max_uses,used_count) VALUES('legacy','alice','Private label','hash','encrypted',1,9999999999999,20,7)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,invite_link_id) VALUES('redemption','alice','fixture@example.com',2,9999999999999,'legacy')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO invite_link_claim VALUES('claim','pending','legacy','pending@example.com',9999999999999)",
      )
      .run();
    const before = await db.prepare('SELECT * FROM invite_link').first();
    const statements = unstable_splitSqlQuery(
      await readFile('migrations/0024_fixed_invite_links.sql', 'utf8'),
    );
    await expect(
      db.batch(
        [
          ...statements,
          "INSERT INTO invite_link(id,inviter_id,token_hash,created_at,expires_at,max_uses) VALUES('bad','alice','bad',1,2,20)",
        ].map((sql) => db.prepare(sql)),
      ),
    ).rejects.toThrow();
    expect(await db.prepare('SELECT * FROM invite_link').first()).toEqual(
      before,
    );
    await db.batch(statements.map((sql) => db.prepare(sql)));
    const expected: Record<string, unknown> = { ...before, max_uses: 100 };
    delete expected.name;
    expect(await db.prepare('SELECT * FROM invite_link').first()).toEqual(
      expected,
    );
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    expect(
      await db
        .prepare("SELECT invite_link_id FROM invitation WHERE id='redemption'")
        .first('invite_link_id'),
    ).toBe('legacy');
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM invite_link_claim')
        .first('count'),
    ).toBe(1);
    await expect(
      db.prepare("UPDATE invite_link SET max_uses=50 WHERE id='legacy'").run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "INSERT INTO invite_link(id,inviter_id,token_hash,created_at,expires_at,max_uses) VALUES('bad','alice','bad',1,2,20)",
        )
        .run(),
    ).rejects.toThrow();
  } finally {
    await runtime.worker.dispose();
  }
});

it('replaces unused link history atomically while preserving personal invitations, membership, and Activity', async () => {
  const runtime = await testRuntime(false, false, undefined, undefined, 24);
  const db = runtime.db;
  try {
    await db
      .prepare(
        "INSERT INTO invite_link(id,inviter_id,token_hash,token_encrypted,created_at,expires_at,max_uses) VALUES('unused','alice','old-hash','old-ciphertext',1,9999999999999,100)",
      )
      .run();
    const snapshot = async () =>
      Promise.all(
        [
          'membership',
          'invitation',
          'activity_source',
          'activity_read_state',
          'push_delivery',
          'session',
        ].map(
          async (table) =>
            (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
              .results,
        ),
      );
    const before = await snapshot();
    const statements = unstable_splitSqlQuery(
      await readFile('migrations/0025_current_invite_link.sql', 'utf8'),
    );
    await expect(
      db.batch(
        [
          ...statements,
          "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) VALUES('bob','alice','duplicate@example.com',1,2)",
        ].map((sql) => db.prepare(sql)),
      ),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(
      await db
        .prepare("SELECT token_encrypted FROM invite_link WHERE id='unused'")
        .first('token_encrypted'),
    ).toBe('old-ciphertext');
    await db.batch(statements.map((sql) => db.prepare(sql)));
    const after = await snapshot();
    const invitations = after[1].map(({ kind, ...row }) => {
      expect(kind).toBe('personal');
      return { ...row, invite_link_id: null };
    });
    after[1] = invitations;
    expect(after).toEqual(before);
    expect(
      (await db.prepare('SELECT * FROM invite_link').all()).results,
    ).toEqual([]);
    expect(
      (
        await db
          .prepare('PRAGMA table_info(invite_link)')
          .all<{ name: string }>()
      ).results.map((column) => column.name),
    ).not.toContain('max_uses');
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    await db
      .prepare(
        "INSERT INTO invite_link(inviter_id,id,token_hash,created_at,expires_at) VALUES('alice','one','one-hash',1,2)",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO invite_link(inviter_id,id,token_hash,created_at,expires_at) VALUES('alice','two','two-hash',1,2)",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE invitation SET kind='shared' WHERE id='bob'").run(),
    ).rejects.toThrow();
  } finally {
    await runtime.worker.dispose();
  }
});

it.each(['redemption', 'claim'])(
  'refuses to discard unexpected shared %s data during migration',
  async (kind) => {
    const runtime = await testRuntime(false, false, undefined, undefined, 24);
    const db = runtime.db;
    try {
      await db
        .prepare(
          "INSERT INTO invite_link(id,inviter_id,token_hash,created_at,expires_at,max_uses) VALUES('unused','alice','hash',1,9999999999999,100)",
        )
        .run();
      if (kind === 'redemption')
        await db
          .prepare(
            "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,invite_link_id) VALUES('unexpected','alice','new@example.com',1,9999999999999,'unused')",
          )
          .run();
      else
        await db
          .prepare(
            "INSERT INTO invite_link_claim VALUES('claim','unexpected','unused','new@example.com',9999999999999)",
          )
          .run();
      const before = (await db.prepare('SELECT * FROM invite_link').all())
        .results;
      const statements = unstable_splitSqlQuery(
        await readFile('migrations/0025_current_invite_link.sql', 'utf8'),
      );
      await expect(
        db.batch(statements.map((sql) => db.prepare(sql))),
      ).rejects.toThrow();
      expect(
        (await db.prepare('SELECT * FROM invite_link').all()).results,
      ).toEqual(before);
      expect(
        (await db.prepare('PRAGMA foreign_key_check').all()).results,
      ).toEqual([]);
    } finally {
      await runtime.worker.dispose();
    }
  },
);

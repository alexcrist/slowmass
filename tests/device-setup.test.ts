import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
it('resumes new-member setup across sessions and completes idempotently without changing notification consent', async () => {
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toMatchObject({ deviceSetupPending: true });
  expect(
    (await runtime.request('alice', '/api/device-setup', 'DELETE')).status,
  ).toBe(409);
  await runtime.request('alice', '/api/people/self', 'PUT', {
    handle: 'alice',
    displayName: 'Alice',
    bio: '',
  });
  await seedProfilePhotos(runtime.db);
  expect(
    await (await runtime.request('alice', '/api/device-setup')).json(),
  ).toEqual({ pending: true });
  await runtime.db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind('other', 'alice', 'other-token', Date.now() + 86400000, 1, 1)
    .run();
  expect(
    await (await runtime.request('other', '/api/bootstrap')).json(),
  ).toMatchObject({ deviceSetupPending: true, profile: { hasAvatar: 1 } });
  for (const id of ['other', 'alice', 'other']) {
    expect(
      (await runtime.request(id, '/api/device-setup', 'DELETE')).status,
    ).toBe(200);
    expect(
      await (await runtime.request(id, '/api/bootstrap')).json(),
    ).toMatchObject({ deviceSetupPending: false });
  }
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) n FROM push_subscription')
      .first('n'),
  ).toBe(0);
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM device_setup WHERE user_id='bob'")
      .first(),
  ).not.toBeNull();
});
it('protects optional setup from anonymous, foreign-origin, expired and inactive sessions', async () => {
  for (const method of ['GET', 'DELETE'])
    expect(
      (await runtime.request(null, '/api/device-setup', method)).status,
    ).toBe(401);
  expect(
    (
      await runtime.request('alice', '/api/device-setup', 'DELETE', undefined, {
        Origin: 'https://elsewhere.test',
      })
    ).status,
  ).toBe(403);
  await runtime.db
    .prepare("UPDATE session SET expiresAt=0 WHERE id='other'")
    .run();
  expect(
    (await runtime.request('other', '/api/device-setup', 'DELETE')).status,
  ).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect(
    (await runtime.request('bob', '/api/device-setup', 'GET')).status,
  ).toBe(401);
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM device_setup WHERE user_id='bob'")
      .first(),
  ).toBeNull();
});
it('migrates existing subscriptions and leased deliveries atomically without enrolling existing members', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 26);
  try {
    for (const id of ['alice', 'bob'])
      await old.request(id, '/api/people/self', 'PUT', {
        handle: id,
        displayName: id,
        bio: '',
      });
    await seedProfilePhotos(old.db);
    await old.db.prepare('DELETE FROM follow').run();
    await old.db.batch([
      old.db.prepare(
        "INSERT INTO push_subscription VALUES('device','alice','alice','https://fcm.googleapis.com/synthetic','key','auth',1)",
      ),
      old.db.prepare("INSERT INTO follow VALUES('bob','alice','pending',1)"),
      old.db.prepare(
        "UPDATE push_delivery SET attempts=2,lease='in-flight',lease_until=9999999999999",
      ),
    ]);
    const snapshot = async () =>
      Promise.all(
        ['push_subscription', 'push_delivery', 'activity_read_state'].map(
          async (table) =>
            (await old.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
              .results,
        ),
      );
    const before = await snapshot();
    expect(before[1]).toHaveLength(1);
    const sql = unstable_splitSqlQuery(
      await readFile('migrations/0027_device_setup.sql', 'utf8'),
    );
    await expect(
      old.db.batch(
        [
          ...sql,
          'INSERT INTO push_subscription SELECT * FROM push_subscription',
        ].map((query) => old.db.prepare(query)),
      ),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await old.db.batch(sql.map((query) => old.db.prepare(query)));
    expect(await snapshot()).toEqual(before);
    expect(
      (await old.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    expect(
      await old.db.prepare('SELECT COUNT(*) n FROM device_setup').first('n'),
    ).toBe(0);
    expect(
      await (await old.request('alice', '/api/bootstrap')).json(),
    ).toMatchObject({ deviceSetupPending: false });
    await old.db
      .prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE recipient_id='alice'",
      )
      .run();
    expect(
      await old.db.prepare('SELECT COUNT(*) n FROM push_delivery').first('n'),
    ).toBe(0);
    // New enqueues and session cascades still work after the rebuild.
    await old.db
      .prepare("UPDATE follow SET status='accepted' WHERE follower_id='bob'")
      .run();
    expect(
      await old.db.prepare('SELECT COUNT(*) n FROM push_delivery').first('n'),
    ).toBe(1);
    await old.db.prepare("DELETE FROM session WHERE id='alice'").run();
    expect(
      await old.db
        .prepare('SELECT COUNT(*) n FROM push_subscription')
        .first('n'),
    ).toBe(0);
    expect(
      await old.db.prepare('SELECT COUNT(*) n FROM push_delivery').first('n'),
    ).toBe(0);
  } finally {
    await old.worker.dispose();
  }
});
it('reports whether the member has a live push subscription on any device', async () => {
  const subscribed = async () =>
    (
      (await (await runtime.request('carol', '/api/bootstrap')).json()) as {
        pushSubscribed: boolean;
      }
    ).pushSubscribed;
  expect(await subscribed()).toBe(false);
  await runtime.db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      'carol-phone',
      'carol',
      'carol-phone-token',
      Date.now() + 86400000,
      1,
      1,
    )
    .run();
  await runtime.db
    .prepare(
      "INSERT INTO push_subscription VALUES('carol-phone','carol','carol-phone','https://web.push.apple.com/synthetic','key','auth',1)",
    )
    .run();
  expect(await subscribed()).toBe(true);
  await runtime.db
    .prepare("UPDATE session SET expiresAt=0 WHERE id='carol-phone'")
    .run();
  expect(await subscribed()).toBe(false);
  expect(
    await (await runtime.request(null, '/api/bootstrap')).json(),
  ).toMatchObject({ user: null, pushSubscribed: false });
});
it('offers setup once to active members from before migration 0027 without overriding earlier answers', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 27);
  try {
    const before0027 = 1791940027026;
    // Erin and Frank joined before 0027; the base fixtures joined afterward.
    for (const id of ['erin', 'frank'])
      await old.db.batch([
        old.db
          .prepare(
            'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,1,1)',
          )
          .bind(id, id, `${id}@example.com`),
        old.db
          .prepare(
            "INSERT INTO invitation (id,inviter_id,recipient_email,created_at,expires_at) VALUES (?,'alice',?,1,?)",
          )
          .bind(id, `${id}@example.com`, before0027 + 1),
        old.db
          .prepare(
            "INSERT INTO membership (user_id,invited_by,invitation_id,joined_at) VALUES (?,'alice',?,?)",
          )
          .bind(id, id, before0027),
      ]);
    await old.db.batch([
      old.db.prepare('DELETE FROM device_setup'),
      old.db.prepare("INSERT INTO device_setup VALUES('bob')"),
      old.db.prepare(
        "UPDATE membership SET status='disabled' WHERE user_id='frank'",
      ),
    ]);
    const pending = async () =>
      (
        await old.db
          .prepare('SELECT user_id FROM device_setup ORDER BY user_id')
          .all<{ user_id: string }>()
      ).results.map((row) => row.user_id);
    expect(await pending()).toEqual(['bob']);
    await old.db.batch(
      unstable_splitSqlQuery(
        await readFile('migrations/0028_device_setup_offer.sql', 'utf8'),
      ).map((query) => old.db.prepare(query)),
    );
    // Base fixtures joined after 0027; without a row they already answered
    // the onboarding offer, so it is not asked again. Bob's row is kept.
    expect(await pending()).toEqual(['bob', 'erin']);
    expect(
      (await old.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await old.worker.dispose();
  }
});

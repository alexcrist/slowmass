import { afterAll, beforeAll, expect, it } from 'vitest';
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
    .bind(
      'other',
      'alice',
      'other-token',
      new Date(Date.now() + 86400000).toISOString(),
      1,
      1,
    )
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
    .prepare(
      "UPDATE session SET expiresAt='2020-01-01T00:00:00.000Z' WHERE id='other'",
    )
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
      new Date(Date.now() + 86400000).toISOString(),
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
    .prepare(
      "UPDATE session SET expiresAt='2020-01-01T00:00:00.000Z' WHERE id='carol-phone'",
    )
    .run();
  expect(await subscribed()).toBe(false);
  expect(
    await (await runtime.request(null, '/api/bootstrap')).json(),
  ).toMatchObject({ user: null, pushSubscribed: false });
});

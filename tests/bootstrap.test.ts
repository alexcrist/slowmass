import { beforeAll, afterAll, it, expect } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});

it('returns availability, session and only the current member profile in one private response', async () => {
  const guest = await runtime.request(null, '/api/bootstrap');
  expect(guest.headers.get('Cache-Control')).toBe('private, no-store');
  expect(guest.headers.get('Server-Timing')).toContain('app;dur=');
  expect(await guest.json()).toEqual({
    signInAvailable: true,
    deviceSetupPending: false,
    pushSubscribed: false,
    user: null,
    profile: null,
  });
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toEqual({
    signInAvailable: true,
    deviceSetupPending: true,
    pushSubscribed: false,
    user: { id: 'alice', name: 'alice' },
    profile: null,
  });
  await runtime.request('alice', '/api/people/self', 'PUT', {
    handle: 'alice',
    displayName: 'Alice',
    bio: 'Only Alice',
  });
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toMatchObject({
    profile: { handle: 'alice', bio: 'Only Alice', hasAvatar: 0 },
  });
  await seedProfilePhotos(runtime.db);
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toMatchObject({ profile: { hasAvatar: 1 } });
  expect(await (await runtime.request('bob', '/api/bootstrap')).json()).toEqual(
    {
      signInAvailable: true,
      deviceSetupPending: true,
      pushSubscribed: false,
      user: { id: 'bob', name: 'bob' },
      profile: null,
    },
  );
  await runtime.db
    .prepare(
      "UPDATE session SET expiresAt='2020-01-01T00:00:00.000Z' WHERE userId='alice'",
    )
    .run();
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toEqual({
    signInAvailable: true,
    deviceSetupPending: false,
    pushSubscribed: false,
    user: null,
    profile: null,
  });
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect(await (await runtime.request('bob', '/api/bootstrap')).json()).toEqual(
    {
      signInAvailable: true,
      deviceSetupPending: false,
      pushSubscribed: false,
      user: null,
      profile: null,
    },
  );
});

it('renews a sixty-day session cookie only through bootstrap', async () => {
  const day = 86400000;
  const expiry = () =>
    runtime.db
      .prepare("SELECT expiresAt FROM session WHERE id='carol'")
      .first<string>('expiresAt');
  // Last renewed 59 days ago, so the daily renewal is due.
  const due = new Date(Date.now() + day).toISOString();
  await runtime.db
    .prepare("UPDATE session SET expiresAt=? WHERE id='carol'")
    .bind(due)
    .run();
  const ordinary = await runtime.request('carol', '/api/me');
  expect(ordinary.status).toBe(200);
  // Other responses cannot carry the renewed cookie, so they must not renew.
  expect(ordinary.headers.get('Set-Cookie')).toBeNull();
  expect(await expiry()).toBe(due);

  const before = Date.now();
  const renewed = await runtime.request('carol', '/api/bootstrap');
  expect((await renewed.json()) as unknown).toMatchObject({
    user: { id: 'carol' },
  });
  const cookie = renewed.headers.get('Set-Cookie') ?? '';
  expect(cookie).toContain('better-auth.session_token=');
  expect(cookie).toContain('Max-Age=5184000');
  expect(cookie).toContain('HttpOnly');
  const extended = Date.parse((await expiry()) ?? '');
  expect(extended).toBeGreaterThanOrEqual(before + 60 * day);
  expect(extended).toBeLessThanOrEqual(Date.now() + 60 * day);

  // Renewal happens at most daily, so most app starts write nothing.
  const repeat = await runtime.request('carol', '/api/bootstrap');
  expect(repeat.headers.get('Set-Cookie')).toBeNull();
  expect(Date.parse((await expiry()) ?? '')).toBe(extended);
});

it('discourages indexing of dynamic responses, including denied and missing resources', async () => {
  for (const path of [
    '/api/status',
    '/api/bootstrap',
    '/api/people/self',
    '/api/missing',
    '/media/missing',
    '/event/invalid',
  ]) {
    const response = await runtime.request(null, path);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  }
});

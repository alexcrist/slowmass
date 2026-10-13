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
    user: null,
    profile: null,
  });
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toEqual({
    signInAvailable: true,
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
    { signInAvailable: true, user: { id: 'bob', name: 'bob' }, profile: null },
  );
  await runtime.db
    .prepare("UPDATE session SET expiresAt=0 WHERE userId='alice'")
    .run();
  expect(
    await (await runtime.request('alice', '/api/bootstrap')).json(),
  ).toEqual({ signInAvailable: true, user: null, profile: null });
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect(await (await runtime.request('bob', '/api/bootstrap')).json()).toEqual(
    { signInAvailable: true, user: null, profile: null },
  );
});

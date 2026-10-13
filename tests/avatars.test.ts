import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testRuntime } from './support/runtime';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime(false, true);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
it('requires onboarding photos, validates uploads, preserves replacements and prevents removal', async () => {
  expect(
    (
      await runtime.request('alice', '/api/people/self', 'PUT', {
        handle: 'alice',
        displayName: 'Alice',
        bio: '',
      })
    ).status,
  ).toBe(200);
  for (const [path, method, body] of [
    ['/api/posts', 'GET', undefined],
    ['/api/posts', 'POST', {}],
    ['/api/interactions/example/like', 'PUT', undefined],
    ['/api/notifications', 'GET', undefined],
    ['/api/invitations', 'POST', { email: 'new@example.com' }],
    ['/api/people/bob/request', 'POST', undefined],
    ['/api/people/discover', 'GET', undefined],
  ] as const)
    expect(
      (await runtime.request('alice', path, method, body)).status,
      path,
    ).toBe(409);
  expect((await runtime.request('alice', '/api/people/self')).status).toBe(200);
  expect((await runtime.request(null, '/api/avatar', 'PUT')).status).toBe(401);
  expect((await runtime.request('bob', '/api/avatar', 'PUT')).status).toBe(409);
  const photo = new Blob(
    [new Uint8Array(await readFile('tests/fixtures/photos/still.png'))],
    { type: 'image/png' },
  );
  const id = crypto.randomUUID();
  const upload = () =>
    runtime.request('alice', '/api/avatar', 'PUT', photo, {
      'Idempotency-Key': id,
      'Content-Type': photo.type,
    });
  expect((await upload()).status).toBe(200);
  expect((await upload()).status).toBe(200);
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS count FROM photo_attempt')
      .first(),
  ).toEqual({ count: 1 });
  expect(
    (await (
      await runtime.request('alice', '/api/people/self')
    ).json()) as object,
  ).toMatchObject({ profile: { hasAvatar: 1 } });
  expect((await runtime.request('alice', '/api/posts')).status).toBe(200);
  const original = await runtime.db
    .prepare("SELECT object_key FROM avatar WHERE user_id='alice'")
    .first<{ object_key: string }>();
  expect(
    (
      await runtime.request(
        'alice',
        '/api/avatar',
        'PUT',
        new Blob(['invalid']),
        { 'Idempotency-Key': crypto.randomUUID() },
      )
    ).status,
  ).toBe(422);
  expect(
    await runtime.db
      .prepare("SELECT object_key FROM avatar WHERE user_id='alice'")
      .first(),
  ).toEqual(original);
  expect((await runtime.request('alice', '/api/avatar', 'DELETE')).status).toBe(
    409,
  );
  expect((await runtime.request('alice', '/media/avatar/alice')).status).toBe(
    200,
  );
  expect(
    (
      await runtime.request('alice', '/api/avatar', 'PUT', photo, {
        'Idempotency-Key': crypto.randomUUID(),
        'Content-Type': photo.type,
      })
    ).status,
  ).toBe(200);
  const replacement = await runtime.db
    .prepare("SELECT object_key FROM avatar WHERE user_id='alice'")
    .first<{ object_key: string }>();
  expect(replacement?.object_key).not.toBe(original?.object_key);
  expect(
    await runtime.db
      .prepare('SELECT 1 AS queued FROM photo_cleanup WHERE object_key=?')
      .bind(original!.object_key)
      .first(),
  ).toEqual({ queued: 1 });
  expect(
    (await runtime.request('alice', '/media/avatar/alice')).headers.get(
      'Content-Type',
    ),
  ).toBe('image/webp');
});

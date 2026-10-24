import { beforeAll, afterAll, it, expect } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});

const signIn = { error: 'Sign in to continue.' };
const addPhoto = {
  error: 'Add a profile photo to finish setting up your account.',
};

// Gated GET handlers run alongside the membership check; a denial must replace
// their response entirely rather than leak it or merge into it.
it('replaces concurrent read responses when membership or photo setup is missing', async () => {
  const reads = [
    '/api/posts',
    '/api/posts?handle=bob',
    '/api/notifications/unread-count',
  ];
  for (const path of reads)
    expect((await runtime.request('alice', path)).status).toBe(200);

  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  for (const path of reads) {
    const response = await runtime.request('alice', path);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(signIn);
  }
  expect(
    (await runtime.request('alice', '/api/notifications/read', 'POST', {}))
      .status,
  ).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();

  await runtime.db.prepare("DELETE FROM avatar WHERE user_id='alice'").run();
  const feed = await runtime.request('alice', '/api/posts');
  expect(feed.status).toBe(409);
  expect(await feed.json()).toEqual(addPhoto);
  // Activity does not require a profile photo.
  expect(
    (await runtime.request('alice', '/api/notifications/unread-count')).status,
  ).toBe(200);
});

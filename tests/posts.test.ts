import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { testRuntime } from './support/runtime';
import {
  createDraft,
  publishPhoto,
  cleanupPosts,
} from '../src/server/features/posts';
import type { Env } from '../src/server/env';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'DELETE FROM post',
      'DELETE FROM photo_attempt',
      'DELETE FROM photo_cleanup',
      'DELETE FROM follow',
      'DELETE FROM block',
      'DELETE FROM profile',
    ].map((sql) => runtime.db.prepare(sql)),
  );
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: `Private ${id}`,
    });
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
});
async function seed(
  id: string,
  owner: string,
  time: number,
  state = 'published',
) {
  await runtime.db
    .prepare(
      'INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES(?,?,?,?,?,?,?,?,1,1)',
    )
    .bind(
      id,
      owner,
      `Caption ${id}`,
      'Alt text',
      time,
      time,
      state,
      `posts/${id}.webp`,
    )
    .run();
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`posts/${id}.webp`, 'synthetic output');
}
type Feed = { items: { id: string }[]; next: string | null };
async function feed(cursor?: string) {
  return (
    await runtime.request(
      'alice',
      `/api/posts${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
    )
  ).json() as Promise<Feed>;
}
it('paginates a follows-only chronological snapshot without duplicates across inserts and deletions', async () => {
  for (let i = 0; i < 27; i++)
    await seed(`bob-${String(i).padStart(2, '0')}`, 'bob', 1000 + i);
  await seed('own', 'alice', 3000);
  await seed('stranger', 'carol', 5000);
  const first = await feed();
  expect(first.items).toHaveLength(12);
  expect(first.items[0].id).toBe('bob-26');
  expect(first.items.some((p) => p.id === 'own' || p.id === 'stranger')).toBe(
    false,
  );
  await seed('later', 'bob', 6000);
  await runtime.request('bob', '/api/posts/bob-14', 'DELETE');
  const second = await feed(first.next!);
  expect(second.items[0].id).toBe('bob-13');
  const third = await feed(second.next!);
  expect(third.next).toBeNull();
  const ids = [...first.items, ...second.items, ...third.items].map(
    (p) => p.id,
  );
  expect(ids).toHaveLength(26);
  expect(new Set(ids).size).toBe(26);
  expect(ids).not.toContain('later');
  expect(ids).not.toContain('bob-14');
  expect((await feed()).items[0].id).toBe('later');
});
it('uses the ID tiebreaker for existing posts with identical timestamps', async () => {
  for (let i = 0; i < 14; i++)
    await seed(`same-${String(i).padStart(2, '0')}`, 'bob', 1000);
  const first = await feed();
  const second = await feed(first.next!);
  expect([...first.items, ...second.items].map((p) => p.id)).toHaveLength(14);
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(
    14,
  );
});
it('revokes post, media and profile-feed access after removal or blocking', async () => {
  await seed('private', 'bob', 1000);
  expect((await runtime.request(null, '/api/posts/private')).status).toBe(401);
  expect((await runtime.request('carol', '/api/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('carol', '/media/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    200,
  );
  const dto = (await (
    await runtime.request('alice', '/api/posts/private')
  ).json()) as { post: Record<string, unknown> };
  expect(dto.post).not.toHaveProperty('objectKey');
  expect(dto.post).not.toHaveProperty('ownerId');
  await runtime.request('bob', '/api/people/alice/remove', 'POST');
  expect((await runtime.request('alice', '/api/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/api/posts?handle=bob')).status).toBe(
    404,
  );
  expect((await feed()).items).toEqual([]);
  await runtime.request('alice', '/api/people/bob/request', 'POST');
  await runtime.request('bob', '/api/people/alice/accept', 'POST');
  await runtime.request('alice', '/api/people/bob/block', 'POST');
  expect((await runtime.request('alice', '/media/posts/private')).status).toBe(
    404,
  );
});
it('keeps drafts private and deletes posts immediately with durable cleanup', async () => {
  await seed('draft', 'bob', 1000, 'pending');
  await seed('published', 'bob', 2000);
  expect((await runtime.request('alice', '/api/posts/draft')).status).toBe(404);
  expect((await runtime.request('bob', '/api/posts/draft')).status).toBe(200);
  expect((await runtime.request('bob', '/media/posts/draft')).status).toBe(404);
  expect(
    (await runtime.request('alice', '/api/posts/published', 'DELETE')).status,
  ).toBe(404);
  expect(
    (await runtime.request('bob', '/api/posts/published', 'DELETE')).status,
  ).toBe(200);
  expect(
    (await runtime.request('bob', '/api/posts/published', 'DELETE')).status,
  ).toBe(200);
  expect((await runtime.request('bob', '/media/posts/published')).status).toBe(
    404,
  );
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await cleanupPosts(
    runtime.db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  expect(await bucket.get('posts/published.webp')).toBeNull();
});
it('rejects malformed cursors without broadening access', async () => {
  expect((await runtime.request('alice', '/api/posts?cursor=bad')).status).toBe(
    400,
  );
  expect(
    (
      await runtime.request(
        'alice',
        '/api/posts?cursor=' +
          btoa(JSON.stringify({ snapshot: -1, before: 2, id: 'x' })),
      )
    ).status,
  ).toBe(400);
});
async function processingEnv() {
  const output = readFileSync('tests/fixtures/photos/still.webp');
  const transform = vi.fn(async () => ({
    response: () => new Response(output),
  }));
  const images = {
    info: async () => ({
      format: 'image/webp',
      width: 120,
      height: 80,
      fileSize: output.length,
    }),
    input: () => ({ transform: () => ({ output: transform }) }),
  };
  return {
    env: {
      DB: runtime.db,
      PHOTOS: await runtime.worker.getR2Bucket('PHOTOS'),
      IMAGES: images,
    } as unknown as Env,
    transform,
  };
}
it('publishes one processed object and makes retries idempotent', async () => {
  const { env, transform } = await processingEnv();
  const id = crypto.randomUUID();
  const draft = { id, caption: 'Caption', altText: 'Description' };
  expect(await createDraft(env.DB, 'alice', draft)).toBe('pending');
  expect(await createDraft(env.DB, 'alice', draft)).toBe('pending');
  const request = () =>
    new Request('http://localhost/upload', {
      method: 'PUT',
      body: readFileSync('tests/fixtures/photos/still.png'),
    });
  expect(await publishPhoto(env, 'alice', id, request())).toBe('published');
  expect(await publishPhoto(env, 'alice', id, request())).toBe('published');
  expect(transform).toHaveBeenCalledTimes(1);
  expect(await createDraft(env.DB, 'alice', draft)).toBe('published');
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS count FROM post').first(),
  ).toEqual({ count: 1 });
  expect(
    await runtime.db.prepare('SELECT 1 FROM photo_cleanup').first(),
  ).toBeNull();
});
it('leaves failed processing unpublished and its cleanup intent retryable', async () => {
  const { env, transform } = await processingEnv();
  transform.mockRejectedValue(new Error('Provider unavailable'));
  const id = crypto.randomUUID();
  await createDraft(env.DB, 'alice', { id, caption: '', altText: '' });
  await expect(
    publishPhoto(
      env,
      'alice',
      id,
      new Request('http://localhost/upload', {
        method: 'PUT',
        body: readFileSync('tests/fixtures/photos/still.png'),
      }),
    ),
  ).rejects.toThrow('unavailable');
  expect(
    await runtime.db
      .prepare('SELECT state,object_key FROM post WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ state: 'failed', object_key: null });
  expect((await runtime.request('alice', `/media/posts/${id}`)).status).toBe(
    404,
  );
});
it('rejects a competing upload and cannot publish after deletion during processing', async () => {
  const { env, transform } = await processingEnv();
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let entered!: () => void;
  const processing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  transform.mockImplementation(async () => {
    entered();
    await paused;
    return {
      response: () =>
        new Response(readFileSync('tests/fixtures/photos/still.webp')),
    };
  });
  const id = crypto.randomUUID();
  await createDraft(env.DB, 'alice', { id, caption: '', altText: '' });
  const request = () =>
    new Request('http://localhost/upload', {
      method: 'PUT',
      body: readFileSync('tests/fixtures/photos/still.png'),
    });
  const first = publishPhoto(env, 'alice', id, request());
  await processing;
  expect(await publishPhoto(env, 'alice', id, request())).toBe('conflict');
  expect(
    (await runtime.request('alice', `/api/posts/${id}`, 'DELETE')).status,
  ).toBe(200);
  resume();
  expect(await first).toBe('conflict');
  expect(transform).toHaveBeenCalledTimes(1);
  expect((await runtime.request('alice', `/media/posts/${id}`)).status).toBe(
    404,
  );
  const intent = await runtime.db
    .prepare('SELECT object_key FROM photo_cleanup')
    .first<{ object_key: string }>();
  expect(intent).not.toBeNull();
  expect(await env.PHOTOS.head(intent!.object_key)).not.toBeNull();
  await runtime.db.prepare('UPDATE photo_cleanup SET not_before=0').run();
  await cleanupPosts(env.DB, env.PHOTOS);
  expect(await env.PHOTOS.head(intent!.object_key)).toBeNull();
});

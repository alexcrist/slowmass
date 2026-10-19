import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import { saveAvatar } from '../src/server/features/avatars';
import { saveEventPhoto } from '../src/server/features/events';
import type { Env } from '../src/server/env';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
  await runtime.request('alice', '/api/people/self', 'PUT', {
    handle: 'alice',
    displayName: 'Alice',
    bio: '',
  });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => runtime?.worker.dispose());

it.each(['avatar', 'event'] as const)(
  'keeps a completed %s retryable after losing the commit reply',
  async (kind) => {
    const upload = crypto.randomUUID();
    const id = crypto.randomUUID();
    if (kind === 'event') {
      const response = await runtime.request('alice', '/api/events', 'POST', {
        id,
        title: 'Dinner',
        description: '',
        location: '',
        startsAt: Date.now() + 86_400_000,
        endsAt: null,
        timeZone: 'UTC',
      });
      expect(response.status).toBe(200);
    }
    const attempt = `alice:${kind === 'event' ? 'event/' : ''}${upload}`;
    const output = readFileSync('tests/fixtures/photos/still.webp');
    const transform = vi.fn(async () => ({
      response: () => new Response(output),
    }));
    const real = runtime.db as unknown as D1Database;
    let loseReply = true;
    const db = new Proxy(real, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            const done = await real
              .prepare(
                "SELECT 1 FROM photo_attempt WHERE id=? AND state='done'",
              )
              .bind(attempt)
              .first();
            if (done && loseReply) {
              loseReply = false;
              throw new Error('Reply lost after commit');
            }
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const env = {
      DB: db,
      PHOTOS: await runtime.worker.getR2Bucket('PHOTOS'),
      IMAGES: {
        info: async () => ({
          format: 'image/webp',
          width: 120,
          height: 80,
          fileSize: output.length,
        }),
        input: () => ({ transform: () => ({ output: transform }) }),
      },
    } as unknown as Env;
    const save = () => {
      const request = new Request('http://localhost/upload', {
        method: 'PUT',
        body: readFileSync('tests/fixtures/photos/still.png'),
      });
      return kind === 'avatar'
        ? saveAvatar(env, 'alice', upload, request)
        : saveEventPhoto(env, 'alice', id, upload, request);
    };
    await expect(save()).rejects.toThrow('Reply lost after commit');
    expect(
      await real
        .prepare('SELECT state FROM photo_attempt WHERE id=?')
        .bind(attempt)
        .first(),
    ).toEqual({ state: 'done' });
    expect(await save()).toBe('done');
    expect(transform).toHaveBeenCalledOnce();
  },
);

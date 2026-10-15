import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { testRuntime } from './support/runtime';
import {
  measuredDatabase,
  measuredObjectRead,
  emptyMetrics,
  requestMetrics,
  performanceMetrics,
  recordMediaCache,
} from '../src/server/telemetry';
import type { Env } from '../src/server/env';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
let db: D1Database;
beforeAll(async () => {
  runtime = await testRuntime();
  db = measuredDatabase(runtime.db as unknown as D1Database);
  await db.prepare('CREATE TABLE metrics_test(value TEXT UNIQUE)').run();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});

it('keeps concurrent request metrics separate and preserves first/all/raw and batch semantics', async () => {
  const a = emptyMetrics(),
    b = emptyMetrics();
  await Promise.all([
    requestMetrics.run(a, async () => {
      expect(
        await db
          .prepare('SELECT id FROM user WHERE id=?')
          .bind('alice')
          .first('id'),
      ).toBe('alice');
    }),
    requestMetrics.run(b, async () => {
      expect(
        (await db.prepare('SELECT id FROM user').all()).results,
      ).toHaveLength(4);
      expect(
        await db.prepare("SELECT id FROM user WHERE id='absent'").first(),
      ).toBeNull();
      expect(
        await db
          .prepare("SELECT id FROM user WHERE id='bob'")
          .raw({ columnNames: true }),
      ).toEqual([['id'], ['bob']]);
      await db.batch([
        db.prepare('INSERT INTO metrics_test VALUES(?)').bind('one'),
        db.prepare('INSERT INTO metrics_test VALUES(?)').bind('two'),
      ]);
    }),
  ]);
  expect(a.queries).toBe(1);
  expect(b.queries).toBe(5);
  expect(a.rowsRead).toBeGreaterThan(0);
  expect(b.rowsRead).toBeGreaterThan(a.rowsRead);
  expect(b.rowsWritten).toBeGreaterThanOrEqual(2);
  expect(b.unmeasuredQueries).toBe(1);
  await expect(
    db.batch([
      db.prepare("INSERT INTO metrics_test VALUES('rollback')"),
      db.prepare("INSERT INTO metrics_test VALUES('one')"),
    ]),
  ).rejects.toThrow();
  expect(
    await db
      .prepare("SELECT value FROM metrics_test WHERE value='rollback'")
      .first(),
  ).toBeNull();
});

it('records safe route templates, timings and media size without retaining request data', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', performanceMetrics);
    app.get('/media/posts/:id', async (c) => {
      recordMediaCache('hit', 2.34);
      await c.env.DB.prepare('SELECT id FROM user WHERE id=?')
        .bind('alice')
        .first();
      return new Response('data', { headers: { 'Content-Length': '4' } });
    });
    const response = await app.request(
      '/media/posts/private-id?token=secret',
      { headers: { Cookie: 'private-cookie' } },
      { DB: db, PERFORMANCE_SAMPLE_RATE: '1' } as Env,
    );
    expect(response.headers.get('Server-Timing')).toMatch(
      /app;dur=[\d.]+, db;dur=[\d.]+/,
    );
    expect(response.headers.get('Server-Timing')).toContain(
      'media-cache;dur=2.3;desc="hit"',
    );
    const serialized = log.mock.calls[0][0];
    const data = JSON.parse(serialized);
    expect(data).toMatchObject({
      event: 'request.performance',
      route: '/media/posts/:id',
      status: 200,
      mediaBytes: 4,
      queries: 1,
      unmeasuredQueries: 0,
      mediaCache: 'hit',
      mediaCacheMs: 2.3,
    });
    for (const privateValue of [
      'private-id',
      'secret',
      'private-cookie',
      'alice',
      'SELECT',
    ])
      expect(serialized).not.toContain(privateValue);
  } finally {
    log.mockRestore();
  }
});

it('distinguishes an unfinished database call from a stall before database access', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    for (const useDatabase of [false, true]) {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const binding = {
        prepare: () => ({
          all: async () => {
            await waiting;
            return {
              results: [],
              meta: { rows_read: 0, rows_written: 0, duration: 2 },
            };
          },
        }),
      } as unknown as D1Database;
      const app = new Hono<{ Bindings: Env }>();
      app.use('*', performanceMetrics);
      app.get('/api/example/:id', async (c) => {
        c.header('X-Request-Id', 'safe-request-id');
        if (useDatabase) await c.env.DB.prepare('SELECT private_data').all();
        else await waiting;
        return c.json({ ok: true });
      });
      const response = app.request(
        '/api/example/private-id?token=private-token',
        undefined,
        { DB: measuredDatabase(binding), PERFORMANCE_SAMPLE_RATE: '1' } as Env,
      );
      await vi.advanceTimersByTimeAsync(5000);
      const serialized = warn.mock.calls.at(-1)![0];
      expect(JSON.parse(serialized)).toMatchObject({
        event: 'request.stalled',
        requestId: 'safe-request-id',
        route: '/api/example/:id',
        queries: useDatabase ? 1 : 0,
        pendingQueries: useDatabase ? 1 : 0,
        databaseMs: 0,
      });
      expect(serialized).not.toContain('private');
      expect(serialized).not.toContain('SELECT');
      release();
      expect((await response).status).toBe(200);
      expect(JSON.parse(info.mock.calls.at(-1)![0])).toMatchObject({
        pendingQueries: 0,
        databaseMs: useDatabase ? 2 : 0,
      });
      if (useDatabase)
        expect(
          JSON.parse(info.mock.calls.at(-1)![0]).databaseWaitMs,
        ).toBeGreaterThanOrEqual(5000);
      expect(vi.getTimerCount()).toBe(0);
    }
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it('retains a safe server bootstrap failure snapshot after the response', async () => {
  const app = new Hono<{ Bindings: Env }>();
  const tasks: Promise<unknown>[] = [];
  const requestId = crypto.randomUUID();
  app.use('*', performanceMetrics);
  app.get('/api/bootstrap', (c) => {
    c.header('X-Request-Id', requestId);
    return c.json({ error: 'private error content' }, 503);
  });
  const response = await app.request(
    '/api/bootstrap?token=secret',
    { headers: { Cookie: 'private-cookie', 'X-Startup-Id': 'not-a-uuid' } },
    { DB: db } as Env,
    {
      waitUntil: (task: Promise<unknown>) => {
        tasks.push(task);
      },
      passThroughOnException() {},
      props: {},
    },
  );
  expect(response.status).toBe(503);
  await Promise.all(tasks);
  const detail = await db
    .prepare('SELECT detail FROM startup_diagnostic WHERE id=?')
    .bind(`server:${requestId}:completed`)
    .first<string>('detail');
  expect(JSON.parse(detail!)).toMatchObject({
    requestId,
    startupId: null,
    outcome: 'completed',
    status: 503,
  });
  expect(detail).not.toMatch(/secret|cookie|private error|not-a-uuid/);
});

it('times successful and failed object lookups without consuming the response body', async () => {
  vi.useFakeTimers();
  try {
    const metrics = emptyMetrics();
    const object = { body: new ReadableStream() } as R2ObjectBody;
    const get = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return object;
    });
    const bucket = { get } as unknown as R2Bucket;
    const read = requestMetrics.run(metrics, () =>
      measuredObjectRead(bucket, 'private-key'),
    );
    await vi.advanceTimersByTimeAsync(25);
    expect(await read).toBe(object);
    expect(object.body.locked).toBe(false);
    expect(metrics.storageReads).toBe(1);
    expect(metrics.storageWaitMs).toBe(25);
    get.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      requestMetrics.run(metrics, () =>
        measuredObjectRead(bucket, 'other-private-key'),
      ),
    ).rejects.toThrow('unavailable');
    expect(metrics.storageReads).toBe(2);
    expect(JSON.stringify(metrics)).not.toContain('private-key');
  } finally {
    vi.useRealTimers();
  }
});

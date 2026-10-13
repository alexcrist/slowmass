import { beforeAll, afterAll, it, expect } from 'vitest';
import { testRuntime } from './support/runtime';
import {
  recordBrowserDiagnostic,
  retainDiagnostic,
  cleanupDiagnostics,
} from '../src/server/diagnostics';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
let db: D1Database;
beforeAll(async () => {
  runtime = await testRuntime();
  db = runtime.db as unknown as D1Database;
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
const report = () => ({
  startupId: crypto.randomUUID(),
  recovered: true,
  failures: [
    {
      attempt: 1,
      outcome: 'timeout',
      durationMs: 10000,
      status: null,
      requestId: null,
    },
  ],
});
it('validates anonymous write-only reports, rejects extra data and deduplicates', async () => {
  const body = report();
  expect(
    await recordBrowserDiagnostic(db, {
      ...body,
      email: 'private@example.com',
    }),
  ).toBe(false);
  expect(
    await recordBrowserDiagnostic(db, {
      ...body,
      failures: [{ ...body.failures[0], token: 'secret' }],
    }),
  ).toBe(false);
  expect(
    await recordBrowserDiagnostic(db, {
      ...body,
      failures: [{ ...body.failures[0], outcome: ['timeout'] }],
    }),
  ).toBe(false);
  expect(await recordBrowserDiagnostic(db, body)).toBe(true);
  expect(await recordBrowserDiagnostic(db, body)).toBe(true);
  expect(
    await db
      .prepare('SELECT count(*) AS count FROM startup_diagnostic')
      .first('count'),
  ).toBe(1);
  const response = await runtime.worker.dispatchFetch(
    'http://localhost:8787/api/startup-diagnostics',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:8787',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report()),
    },
  );
  expect(response.status).toBe(204);
  expect(
    (
      await runtime.worker.dispatchFetch(
        'http://localhost:8787/api/startup-diagnostics',
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await runtime.worker.dispatchFetch(
        'http://localhost:8787/api/startup-diagnostics',
        { method: 'POST', body: JSON.stringify(report()) },
      )
    ).status,
  ).toBe(403);
});
it('caps retained records atomically and removes expired records', async () => {
  await Promise.all(
    Array.from({ length: 210 }, (_, i) =>
      retainDiagnostic(db, `server:${i}`, 'server', { outcome: 'stalled' }),
    ),
  );
  expect(
    await db
      .prepare('SELECT count(*) AS count FROM startup_diagnostic')
      .first('count'),
  ).toBe(200);
  await db
    .prepare('UPDATE startup_diagnostic SET created_at=?')
    .bind(Date.now() - 86_400_001)
    .run();
  await cleanupDiagnostics(db);
  expect(
    await db
      .prepare('SELECT count(*) AS count FROM startup_diagnostic')
      .first('count'),
  ).toBe(0);
});

it('rejects oversized reports with 413 instead of the generic server error', async () => {
  const response = await runtime.worker.dispatchFetch(
    'http://localhost:8787/api/startup-diagnostics',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:8787',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ unexpected: 'x'.repeat(2200) }),
    },
  );
  expect(response.status).toBe(413);
});

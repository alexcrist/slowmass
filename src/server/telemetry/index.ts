import { diagnosticId, retainDiagnostic } from '../diagnostics';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Env } from '../env';

type Metrics = {
  phase?: 'initialize' | 'session' | 'handler' | 'membership';
  authTimedOut?: boolean;
  sessionStage?: 'dispatch' | 'endpoint' | 'lookup';
  queries: number;
  rowsRead: number;
  rowsWritten: number;
  databaseMs: number;
  databaseWaitMs: number;
  pendingQueries: number;
  unmeasuredQueries: number;
  storageReads: number;
  storageWaitMs: number;
  mediaCache?: 'hit' | 'miss' | 'unavailable' | 'not-modified';
  mediaCacheMs?: number;
};
export const requestMetrics = new AsyncLocalStorage<Metrics>();
export function startupPhase(
  phase: NonNullable<Metrics['phase']>,
  authTimedOut = false,
) {
  const metrics = requestMetrics.getStore();
  if (metrics) {
    metrics.phase = phase;
    metrics.authTimedOut = authTimedOut;
  }
}
// Coarse, content-free markers distinguish a pre-handler wait from cookie
// validation or adapter entry. Never record headers, cookies or lookup tokens.
export function sessionStage(stage: NonNullable<Metrics['sessionStage']>) {
  const metrics = requestMetrics.getStore();
  if (metrics) metrics.sessionStage = stage;
}
export const emptyMetrics = (): Metrics => ({
  queries: 0,
  rowsRead: 0,
  rowsWritten: 0,
  databaseMs: 0,
  databaseWaitMs: 0,
  pendingQueries: 0,
  unmeasuredQueries: 0,
  storageReads: 0,
  storageWaitMs: 0,
});

export function recordMediaCache(
  outcome: NonNullable<Metrics['mediaCache']>,
  durationMs: number,
) {
  const metrics = requestMetrics.getStore();
  if (metrics) {
    metrics.mediaCache = outcome;
    metrics.mediaCacheMs = Math.round(durationMs * 10) / 10;
  }
}

// Time object lookup only; preserve streaming and never record keys or bytes.
export async function measuredObjectRead(bucket: R2Bucket, key: string) {
  const metrics = requestMetrics.getStore();
  const start = performance.now();
  if (metrics) metrics.storageReads++;
  try {
    return await bucket.get(key);
  } finally {
    if (metrics) metrics.storageWaitMs += performance.now() - start;
  }
}

async function databaseCall<T>(
  count: number,
  work: () => Promise<T>,
  measured = true,
) {
  const metrics = requestMetrics.getStore();
  const start = performance.now();
  if (metrics) {
    metrics.queries += count;
    metrics.pendingQueries += count;
    if (!measured) metrics.unmeasuredQueries += count;
  }
  try {
    return await work();
  } catch (error) {
    if (metrics && measured) metrics.unmeasuredQueries += count;
    throw error;
  } finally {
    if (metrics) {
      metrics.pendingQueries -= count;
      metrics.databaseWaitMs += performance.now() - start;
    }
  }
}

function record(results: D1Result[]) {
  const metrics = requestMetrics.getStore();
  if (!metrics) return;
  for (const { meta } of results) {
    metrics.rowsRead += meta.rows_read;
    metrics.rowsWritten += meta.rows_written;
    metrics.databaseMs += meta.duration;
  }
}

// Preserve the binding and statement APIs. No SQL, parameters, or result data
// leave this wrapper; batches still execute as one atomic D1 operation.
export function measuredDatabase<T extends D1Database | D1DatabaseSession>(
  db: T,
): T {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function statement(original: D1PreparedStatement): D1PreparedStatement {
    const measured = new Proxy(original, {
      get(target, property) {
        if (property === 'bind')
          return (...values: unknown[]) => statement(target.bind(...values));
        if (property === 'all' || property === 'run')
          return () =>
            databaseCall(1, async () => {
              const result = await target[property]();
              record([result]);
              return result;
            });
        if (property === 'first')
          return async (column?: string) => {
            const { results } = await measured.all<Record<string, unknown>>();
            const first = results[0];
            if (!first) return null;
            if (column === undefined) return first;
            if (!Object.hasOwn(first, column))
              throw new Error('D1_ERROR: Column not found');
            return first[column];
          };
        if (property === 'raw')
          return (options?: { columnNames?: boolean }) =>
            databaseCall(
              1,
              () =>
                options?.columnNames
                  ? target.raw({ columnNames: true })
                  : target.raw(),
              false,
            );
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(measured, original);
    return measured;
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => statement(target.prepare(sql));
      if (property === 'batch')
        return (statements: D1PreparedStatement[]) =>
          databaseCall(statements.length, async () => {
            const results = await target.batch(
              statements.map((item) => originals.get(item) ?? item),
            );
            record(results);
            return results;
          });
      if (property === 'withSession' && 'withSession' in target)
        return (constraint?: D1SessionBookmark | D1SessionConstraint) =>
          measuredDatabase(target.withSession(constraint));
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function measuredEnvironment(env: Env): Env {
  return { ...env, DB: measuredDatabase(env.DB) };
}

export const performanceMetrics: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  if (
    !c.req.path.startsWith('/api/') &&
    !c.req.path.startsWith('/media/') &&
    !c.req.path.startsWith('/event/')
  )
    return next();
  const metrics = emptyMetrics();
  const start = performance.now();
  const persist = (outcome: 'stalled' | 'completed') => {
    if (c.req.path !== '/api/bootstrap' || c.req.method !== 'GET') return;
    const requestId = c.res.headers.get('X-Request-Id');
    if (!diagnosticId(requestId)) return;
    const startupId = c.req.header('X-Startup-Id');
    const attempt = c.req.header('X-Startup-Attempt');
    const task = retainDiagnostic(
      c.env.DB,
      `server:${requestId}:${outcome}`,
      'server',
      {
        requestId,
        startupId: diagnosticId(startupId) ? startupId : null,
        attempt: attempt === '1' || attempt === '2' ? Number(attempt) : null,
        outcome,
        status: outcome === 'completed' ? c.res.status : null,
        durationMs: Math.round(performance.now() - start),
        ...metrics,
      },
    );
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      void task;
    }
  };
  const stalled = setTimeout(() => {
    persist('stalled');
    console.warn(
      JSON.stringify({
        event: 'request.stalled',
        requestId: c.res.headers.get('X-Request-Id'),
        route: routePath(c),
        method: c.req.method,
        durationMs: Math.round(performance.now() - start),
        ...metrics,
      }),
    );
  }, 5000);
  try {
    await requestMetrics.run(metrics, next);
  } finally {
    clearTimeout(stalled);
  }
  const durationMs = Math.round((performance.now() - start) * 10) / 10;
  if (durationMs >= 5000 || c.res.status >= 400) persist('completed');
  c.header(
    'Server-Timing',
    `app;dur=${durationMs}, db;dur=${metrics.databaseMs}, dbwait;dur=${Math.round(metrics.databaseWaitMs * 10) / 10}, r2;dur=${Math.round(metrics.storageWaitMs * 10) / 10}${metrics.mediaCache ? `, media-cache;dur=${metrics.mediaCacheMs};desc="${metrics.mediaCache}"` : ''}`,
  );
  // Aggregate fields only. Do not log URLs (magic-link tokens), identities,
  // request bodies, headers, or query parameters. Only abnormal startup requests retain bounded diagnostics.
  const sampleRate =
    c.env.PERFORMANCE_SAMPLE_RATE === undefined
      ? 0.05
      : Math.max(0, Math.min(1, Number(c.env.PERFORMANCE_SAMPLE_RATE) || 0));
  const sampled = Math.random() < sampleRate;
  if (sampled || durationMs >= 500 || c.res.status >= 500) {
    console.info(
      JSON.stringify({
        event: 'request.performance',
        requestId: c.res.headers.get('X-Request-Id'),
        route: routePath(c),
        method: c.req.method,
        status: c.res.status,
        durationMs,
        ...metrics,
        mediaBytes:
          c.req.path.startsWith('/media/') ||
          (c.req.path.startsWith('/event/') && c.req.path.endsWith('/photo'))
            ? Number(c.res.headers.get('Content-Length') ?? 0)
            : 0,
        sampleRate,
        sampling: sampled ? 'random' : 'slow_or_error',
      }),
    );
  }
};

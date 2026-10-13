import { expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { testRuntime } from '../../../tests/support/runtime';
import { authOptions } from './options';
import { createAuth, getActiveSession } from './index';
import type { Env } from '../env';

it('keeps session checks independent of an abandoned runtime schema inspection', async () => {
  const runtime = await testRuntime();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let holdSchema = true;
  let inspections = 0;
  const db = runtime.db as unknown as D1Database;
  function statement(
    target: D1PreparedStatement,
    schema: boolean,
  ): D1PreparedStatement {
    return new Proxy(target, {
      get(original, property) {
        if (property === 'bind')
          return (...values: unknown[]) =>
            statement(original.bind(...values), schema);
        if (property === 'all' && schema)
          return async () => {
            inspections++;
            if (holdSchema) {
              entered();
              await held;
            }
            return original.all();
          };
        const value: unknown = Reflect.get(original, property);
        return typeof value === 'function' ? value.bind(original) : value;
      },
    });
  }
  const env: Env = {
    DB: new Proxy(db, {
      get(target, property) {
        if (property === 'prepare')
          return (sql: string) =>
            statement(
              target.prepare(sql),
              /sqlite_master|sqlite_schema|pragma/i.test(sql),
            );
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    APP_ORIGIN: 'http://localhost:8787',
    AUTH_SECRET: 'test-only-secret-with-at-least-thirty-two-characters',
    RESEND_API_KEY: 'test-key',
    EMAIL_FROM: 'test@example.com',
  } as Env;
  try {
    const token = 'alice-token';
    const headers = new Headers({
      Cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, env.AUTH_SECRET!)}`)}`,
    });
    const options = authOptions(env);
    const legacy = betterAuth({
      ...options,
      advanced: { ...options.advanced, database: { validateSchema: true } },
    });
    const first = legacy.api.getSession({ headers });
    await started;
    holdSchema = false;
    const second = legacy.api.getSession({ headers });
    expect(
      await Promise.race([
        second.then(() => 'returned'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('stalled'), 100),
        ),
      ]),
    ).toBe('stalled');
    const before = inspections;
    expect(await getActiveSession(env, headers)).toMatchObject({
      user: { id: 'alice' },
      sessionId: 'alice',
    });
    expect(inspections).toBe(before);
    release();
    await Promise.all([first, second]);
  } finally {
    release();
    await runtime.worker.dispose();
  }
});

it('explicitly validates migrated auth tables in CI and catches schema drift', async () => {
  const runtime = await testRuntime();
  const env = {
    DB: runtime.db,
    APP_ORIGIN: 'http://localhost:8787',
    AUTH_SECRET: 'test-only-secret-with-at-least-thirty-two-characters',
  } as unknown as Env;
  try {
    const context = await createAuth(env).$context;
    expect(context.checkSchema).toBeUndefined();
    expect(context.explicitSchemaCheck).toBeTypeOf('function');
    await context.explicitSchemaCheck!();
    await runtime.db
      .prepare('ALTER TABLE session RENAME COLUMN token TO broken_token')
      .run();
    const drifted = await createAuth({ ...env }).$context;
    await expect(drifted.explicitSchemaCheck!()).rejects.toThrow();
  } finally {
    await runtime.worker.dispose();
  }
});

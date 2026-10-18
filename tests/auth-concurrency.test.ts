import { build } from 'esbuild';
import { unstable_readConfig } from 'wrangler';
import { expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { testRuntime } from './support/runtime';

it('bundles the Workers auth dependency without request-owned dynamic async-hooks imports', async () => {
  const result = await build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['node:*'],
    alias: unstable_readConfig({ config: 'wrangler.jsonc', env: 'production' })
      .alias,
  });
  const bundle = result.outputFiles[0].text;
  expect(bundle).toMatch(
    /import\s*\{[^}]*AsyncLocalStorage[^}]*\}\s*from\s*["']node:async_hooks["']/,
  );
  expect(bundle).not.toMatch(
    /import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*["']node:async_hooks["']/,
  );
});

it('keeps an existing cookie usable through aborted HTTP refreshes and enforces logout afterward', async () => {
  const runtime = await testRuntime();
  try {
    const origin = await runtime.worker.ready;
    const token = 'alice-token';
    const secret = 'test-only-secret-with-at-least-thirty-two-characters';
    // Created before any of the requests; rebuilding library instances must
    // neither rotate this cookie nor replace its persisted session.
    const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`;
    const read = (signal?: AbortSignal) =>
      fetch(new URL('/api/bootstrap', origin), {
        headers: { Cookie: cookie },
        signal,
      });
    for (let round = 0; round < 8; round++) {
      const controllers = Array.from(
        { length: 4 },
        () => new AbortController(),
      );
      const interrupted = Promise.allSettled(
        controllers.map((controller) =>
          read(controller.signal).then((response) => response.arrayBuffer()),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      controllers.forEach((controller) => controller.abort());
      const response = await read(AbortSignal.timeout(3000));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { id: 'alice' } });
      await interrupted;
    }
    expect(
      await runtime.db
        .prepare("SELECT count(*) AS n FROM session WHERE userId='alice'")
        .first('n'),
    ).toBe(1);
    expect(
      (await runtime.request('alice', '/api/auth/sign-out', 'POST', {})).status,
    ).toBe(200);
    const signedOut = await read(AbortSignal.timeout(3000));
    expect(await signedOut.json()).toMatchObject({ user: null });
  } finally {
    await runtime.worker.dispose();
  }
});

it('serves independent signed-in startup requests during cold-start cancellations and afterward', async () => {
  const runtime = await testRuntime();
  try {
    const cancelled = Array.from({ length: 6 }, () => new AbortController());
    const abandoned = Promise.allSettled(
      cancelled.map((controller) =>
        runtime.request(
          'alice',
          '/api/bootstrap',
          'GET',
          undefined,
          {},
          controller.signal,
        ),
      ),
    );
    const verify = async () => {
      await Promise.all(
        Array.from({ length: 16 }, async (_, i) => {
          const id = ['alice', 'bob', 'carol', 'david'][i % 4];
          const response = await runtime.request(id, '/api/bootstrap');
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({
            signInAvailable: true,
            deviceSetupPending: true,
            pushSubscribed: false,
            user: { id, name: id },
            profile: null,
          });
          expect(response.headers.get('Cache-Control')).toBe(
            'private, no-store',
          );
        }),
      );
    };
    const concurrent = verify();
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const controller of cancelled) controller.abort();
    await concurrent;
    await abandoned;
    await verify();
  } finally {
    await runtime.worker.dispose();
  }
});

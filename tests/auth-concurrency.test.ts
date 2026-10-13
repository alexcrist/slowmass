import { build } from 'esbuild';
import { unstable_readConfig } from 'wrangler';
import { expect, it } from 'vitest';
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

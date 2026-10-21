import { build } from 'vite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

it('caches only emitted hashed scripts/styles while HTML and missing chunks revalidate', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'slowmass-assets-'));
  try {
    await build({ logLevel: 'silent', build: { outDir } });
    const headers = await readFile(join(outDir, '_headers'), 'utf8');
    // Exercise the actual Workers assets route: privacy must work signed out,
    // without the app bundle or authentication/database configuration.
    const assets = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: '2026-10-10',
        script:
          'export default { fetch() { return new Response("Unexpected Worker fallback", { status: 500 }); } }',
        assets: {
          directory: outDir,
          notFoundHandling: 'single-page-application',
        },
      }),
    );
    try {
      const robots = await assets.dispatchFetch(
        'https://slowmass.test/robots.txt',
      );
      expect(robots.status).toBe(200);
      expect(robots.headers.get('Content-Type')).toContain('text/plain');
      expect(await robots.text()).toContain('User-agent: *\nDisallow: /');
      for (const path of [
        '/',
        '/privacy/',
        '/branding/',
        '/startup.js',
        '/unknown-page',
      ]) {
        const response = await assets.dispatchFetch(
          `https://slowmass.test${path}`,
        );
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      }
      const policy = await assets.dispatchFetch(
        'https://slowmass.test/privacy/',
      );
      expect(policy.status).toBe(200);
      expect(policy.headers.get('Content-Type')).toContain('text/html');
      expect(policy.headers.get('Set-Cookie')).toBeNull();
      expect(policy.headers.get('Cache-Control')).toContain('no-transform');
      const html = await policy.text();
      expect(html).toContain('Your privacy');
      expect(html).not.toContain('<script');
      const css = await assets.dispatchFetch(
        'https://slowmass.test/privacy/privacy.css',
      );
      expect(css.status).toBe(200);
      expect(css.headers.get('Content-Type')).toContain('text/css');
      const home = await assets.dispatchFetch('https://slowmass.test/');
      expect(await home.text()).toContain('href="/privacy/"');
    } finally {
      await assets.dispose();
    }

    const files = (await readdir(join(outDir, 'assets'))).filter((file) =>
      /\.(js|css)$/.test(file),
    );
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      expect(file).toMatch(/-[\w-]{8}\.(js|css)$/);
      expect(headers).toContain(
        `/assets/${file}\n  Cache-Control: public, max-age=31536000, immutable`,
      );
    }
    expect(headers).not.toContain('/assets/*');
    expect(headers).not.toContain('/assets/missing-deployment-probe.js');
    expect(headers).toContain(
      '/*.html\n  Cache-Control: public, max-age=0, must-revalidate, no-transform',
    );
    expect(headers).toContain(
      '/startup.js\n  Cache-Control: no-cache, max-age=0, must-revalidate',
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

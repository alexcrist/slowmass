import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://slowmass.com';
const html = await readFile('dist/index.html', 'utf8');
const assets = new Set([
  '/index.html',
  '/manifest.webmanifest',
  '/startup.js',
  ...Array.from(
    html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g),
    (match) => match[1],
  ),
]);

async function verify() {
  for (const path of assets) {
    const response = await fetch(new URL(path, origin), {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `${path}: status`);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(`dist${path}`),
      `${path}: deployed bytes differ from checked build`,
    );
  }
  for (const [path, status] of [
    ['/api/status', 200],
    ['/api/bootstrap', 200],
    ['/api/posts', 401],
    ['/media/posts/deployment-probe', 404],
  ]) {
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, status, `${path}: status`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (path === '/api/status') {
      assert.equal((await response.json()).signInAvailable, true);
    } else {
      await response.arrayBuffer();
    }
  }
}

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await verify();
    console.log(
      'Deployed assets, sign-in availability and private boundaries verified.',
    );
    break;
  } catch {
    // Do not dump response bodies or asset contents into deployment logs.
    if (attempt === 5) {
      throw new Error(
        'Production HTTP verification failed. Inspect the release; no automatic rollback was attempted.',
      );
    }
    console.log(`Deployment verification attempt ${attempt} failed; retrying.`);
    await setTimeout(3000);
  }
}

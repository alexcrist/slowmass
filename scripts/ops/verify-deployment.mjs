import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://slowmass.com';
const html = await readFile('dist/index.html', 'utf8');
const assets = new Set([
  '/index.html',
  '/manifest.webmanifest',
  '/startup.js',
  ...(await readdir('dist/assets')).map((name) => `/assets/${name}`),
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
    if (path.startsWith('/assets/')) {
      assert.match(
        response.headers.get('cache-control') ?? '',
        /max-age=31536000/,
      );
      assert.match(response.headers.get('cache-control') ?? '', /immutable/);
    } else if (path === '/index.html' || path === '/startup.js') {
      assert.match(
        response.headers.get('cache-control') ?? '',
        /max-age=0|no-cache/,
      );
    }
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(`dist${path}`),
      `${path}: deployed bytes differ from checked build`,
    );
  }
  const missingChunk = await fetch(
    new URL('/assets/missing-deployment-probe.js', origin),
    {
      signal: AbortSignal.timeout(15000),
    },
  );
  assert.doesNotMatch(
    missingChunk.headers.get('cache-control') ?? '',
    /immutable|max-age=31536000/,
  );
  await missingChunk.arrayBuffer();
  for (const [path, status] of [
    ['/api/status', 200],
    ['/api/bootstrap', 200],
    ['/api/posts', 401],
    ['/api/events', 401],
    ['/media/posts/deployment-probe', 404],
    ['/media/events/deployment-probe', 404],
    ['/api/event-link/photo', 404],
    ['/event/deployment-probe', 404],
    ['/event/deployment-probe/photo', 404],
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
  // No session and a synthetic ID: verify deletion boundaries without touching
  // an existing event or creating production fixtures.
  for (const [requestOrigin, status] of [
    [origin, 401],
    ['https://invalid.example', 403],
  ]) {
    const response = await fetch(
      new URL('/api/events/deployment-probe', origin),
      {
        method: 'DELETE',
        headers: { Origin: requestOrigin },
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.equal(response.status, status, 'Event deletion boundary');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    await response.arrayBuffer();
  }
  // Synthetic invalid credentials exercise preview rejection without reading
  // a real event, admitting a member, or sending email.
  for (const [path, status, requestOrigin] of [
    ['/api/event-link', 200, origin],
    ['/api/event-link/photo', 404, origin],
    ['/api/event-link/photo', 403, 'https://invalid.example'],
  ]) {
    const response = await fetch(new URL(path, origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
      body: JSON.stringify({ token: 'invalid-deployment-probe' }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, status, `${path}: preview boundary`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (status === 200)
      assert.deepEqual(await response.json(), { event: null });
    else await response.arrayBuffer();
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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ wait: vi.fn(), read: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.wait }));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.read,
  readdir: async () => ['app-hash.js'],
}));
const html = '<script src="/assets/app-hash.js"></script>';
const bytes = (path) => (path === '/index.html' ? html : 'synthetic asset');
function healthy(url, options = {}) {
  const path = url.pathname;
  if (path === '/assets/missing-deployment-probe.js')
    return new Response('Missing', { status: 404 });
  if (
    path.startsWith('/assets/') ||
    (!path.startsWith('/api/') &&
      !path.startsWith('/media/') &&
      !path.startsWith('/event/'))
  )
    return new Response(bytes(path), {
      headers: {
        'Cache-Control': path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    });
  const headers = { 'Cache-Control': 'private, no-store' };
  if (options.headers?.Origin === 'https://invalid.example')
    return new Response(null, { status: 403, headers });
  if (path === '/api/status')
    return Response.json({ signInAvailable: true }, { headers });
  if (path === '/api/bootstrap') return Response.json({}, { headers });
  if (path === '/api/event-link' && options.method === 'POST')
    return Response.json({ event: null }, { headers });
  const status =
    path === '/api/posts' ||
    path === '/api/events' ||
    options.method === 'DELETE'
      ? 401
      : 404;
  return new Response(null, { status, headers });
}
let output;
beforeEach(() => {
  vi.resetModules();
  mocks.wait.mockReset();
  mocks.read.mockImplementation(async (file, encoding) => {
    const value = bytes(file.slice(4));
    return encoding ? value : Buffer.from(value);
  });
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(healthy));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const run = () => import('../scripts/ops/verify-deployment.mjs');

it('verifies assets, cache policies and every signed-out boundary', async () => {
  await run();
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(19);
  expect(output).toHaveBeenLastCalledWith(expect.stringContaining('verified.'));
});
it('retries stale bytes and completes when the release propagates', async () => {
  fetch.mockImplementationOnce(
    () =>
      new Response('stale synthetic content', {
        headers: { 'Cache-Control': 'no-cache' },
      }),
  );
  await run();
  expect(mocks.wait).toHaveBeenCalledWith(3000);
  expect(output.mock.calls.flat().join(' ')).toContain(
    '/index.html: deployed bytes; HTTP 200',
  );
  expect(output.mock.calls.flat().join(' ')).not.toContain(
    'stale synthetic content',
  );
});
it('bounds persistent HTTP failures and reports no response content', async () => {
  fetch.mockImplementation(
    () => new Response('sensitive synthetic response', { status: 503 }),
  );
  await expect(run()).rejects.toThrow('/index.html: asset status; HTTP 503');
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(mocks.wait.mock.calls.map(([delay]) => delay)).toEqual([
    3000, 6000, 12000, 24000, 30000,
  ]);
  expect(output.mock.calls.flat().join(' ')).not.toContain(
    'sensitive synthetic response',
  );
});
it('does not expose transport exception details', async () => {
  fetch.mockRejectedValue(new Error('synthetic secret transport detail'));
  await expect(run()).rejects.toThrow(
    'GET /index.html: request; HTTP unavailable',
  );
  expect(output.mock.calls.flat().join(' ')).not.toContain('synthetic secret');
});
it('continues to reject private endpoints that lose authorization', async () => {
  fetch.mockImplementation((url, options) =>
    url.pathname === '/api/posts'
      ? new Response('synthetic private content', {
          headers: { 'Cache-Control': 'no-store' },
        })
      : healthy(url, options),
  );
  await expect(run()).rejects.toThrow('/api/posts: private boundary; HTTP 200');
  expect(output.mock.calls.flat().join(' ')).not.toContain(
    'synthetic private content',
  );
});

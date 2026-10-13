import { afterEach, expect, it, vi } from 'vitest';
import { loadStartup } from './startup';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const guest = { signInAvailable: true, user: null, profile: null };
it('recovers once from a server error and sends only safe diagnostic fields', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('private error', { status: 503 }))
    .mockResolvedValueOnce(Response.json(guest))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const result = loadStartup(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500);
  await expect(result).resolves.toEqual(guest);
  expect(fetch).toHaveBeenCalledTimes(3);
  const report = JSON.parse(fetch.mock.calls[2][1].body);
  expect(report.recovered).toBe(true);
  expect(report.failures).toEqual([
    {
      attempt: 1,
      outcome: 'http',
      durationMs: 0,
      status: 503,
      requestId: null,
    },
  ]);
  expect(JSON.stringify(report)).not.toContain('private');
  expect(fetch.mock.calls[2][1].credentials).toBe('omit');
});
it('does not retry valid signed-out responses or permanent HTTP failures', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(guest));
  vi.stubGlobal('fetch', fetch);
  await expect(loadStartup(new AbortController().signal)).resolves.toEqual(
    guest,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch
    .mockReset()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(loadStartup(new AbortController().signal)).rejects.toThrow();
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    '/api/bootstrap',
    '/api/startup-diagnostics',
  ]);
});
it('includes stalled response bodies in the deadline and cancels the retry pause on unmount', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => new Promise(() => {}),
  });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const result = loadStartup(controller.signal).catch(() => 'cancelled');
  await vi.advanceTimersByTimeAsync(10000);
  controller.abort();
  expect(await result).toBe('cancelled');
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

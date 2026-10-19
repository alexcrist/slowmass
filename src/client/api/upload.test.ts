import { afterEach, expect, it, vi } from 'vitest';
import { api, onUnauthorized } from './index';
import { mockUploads } from '../../../tests/support/upload';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const photo = new Blob(['photo'], { type: 'image/webp' });
const options = (onUploadProgress = vi.fn()) => ({
  method: 'PUT',
  body: photo,
  headers: { 'Content-Type': photo.type, 'Idempotency-Key': 'same-operation' },
  onUploadProgress,
});

it('reports byte progress and waits for a server acknowledgement after all bytes are sent', async () => {
  let respond!: (value: Response) => void;
  const requests = mockUploads(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const progress = vi.fn();
  let complete = false;
  const result = api('/api/avatar', options(progress)).then(() => {
    complete = true;
  });
  const xhr = requests[0];
  expect(xhr.headers).toMatchObject({
    'idempotency-key': 'same-operation',
    'content-type': photo.type,
  });
  expect(xhr.body).toBe(photo);
  xhr.progress(25);
  xhr.progress(30, 0, false);
  xhr.progress(100);
  xhr.sent();
  xhr.progress(20); // Out-of-order progress must not move processing backwards.
  expect(progress.mock.calls).toEqual([[0], [25], [null], [99], [100]]);
  expect(complete).toBe(false);
  respond(Response.json({ ok: true }));
  await result;
  expect(complete).toBe(true);
  expect(xhr.onload).toBeNull();
});

it('ends a hung upload, aborts its transport, and ignores late progress and success', async () => {
  vi.useFakeTimers();
  let respond!: (value: Response) => void;
  const requests = mockUploads(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const progress = vi.fn();
  const pending = api('/api/avatar', options(progress));
  const failure = expect(pending).rejects.toThrow('too long to confirm');
  await vi.advanceTimersByTimeAsync(120_000);
  await failure;
  expect(requests[0].controller.signal.aborted).toBe(true);
  requests[0].sent();
  respond(Response.json({ ok: true }));
  await Promise.resolve();
  expect(progress.mock.calls).toEqual([[0]]);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels immediately, including before send, and preserves session-expiry handling', async () => {
  const requests = mockUploads();
  const controller = new AbortController();
  const pending = api('/api/avatar', {
    ...options(),
    signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toThrow('Cancelled');
  controller.abort();
  await rejected;
  await expect(
    api('/api/avatar', { ...options(), signal: controller.signal }),
  ).rejects.toThrow('Cancelled');
  expect(requests[1].body).toBeUndefined();
  const unauthorized = vi.fn();
  const unsubscribe = onUnauthorized(unauthorized);
  mockUploads(async () =>
    Response.json({ error: 'Sign in to continue.' }, { status: 401 }),
  );
  try {
    await expect(api('/api/avatar', options())).rejects.toMatchObject({
      status: 401,
    });
    expect(unauthorized).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
  }
});

it('bounds stalled JSON decoding through the configured mutation deadline', async () => {
  vi.useFakeTimers();
  let decode!: (body: unknown) => void;
  const response = Response.json({});
  vi.spyOn(response, 'json').mockImplementation(
    () =>
      new Promise((resolve) => {
        decode = resolve;
      }),
  );
  const fetch = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetch);
  const pending = api('/api/posts', { method: 'POST', timeoutMs: 30_000 });
  const rejected = expect(pending).rejects.toThrow('too long to confirm');
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  decode({ state: 'pending' });
  await Promise.resolve();
});

it('does not report success for an unreadable upload acknowledgement', async () => {
  mockUploads(async () => new Response('<html>Unavailable</html>'));
  await expect(api('/api/avatar', options())).rejects.toThrow(
    'could not be confirmed',
  );
});

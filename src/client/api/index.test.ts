import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from './index';
import { separateReads } from './reads';

afterEach(() => {
  separateReads();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('shares concurrent GETs through body decoding but never reuses a completed response', async () => {
  const body = deferred<unknown>();
  const response = Response.json({});
  vi.spyOn(response, 'json').mockReturnValue(body.promise);
  const fetch = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetch);
  const first = api('/api/posts');
  await Promise.resolve();
  const second = api('/api/posts', { method: 'GET' });
  expect(fetch).toHaveBeenCalledTimes(1);
  body.resolve({ items: ['new'] });
  expect(await Promise.all([first, second])).toEqual([
    { items: ['new'] },
    { items: ['new'] },
  ]);
  await api('/api/posts');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('cancels one reader without aborting another reader of the same GET', async () => {
  const response = deferred<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal('fetch', fetch);
  const a = new AbortController(),
    b = new AbortController();
  const first = api('/api/posts', { signal: a.signal }).catch(
    (error: unknown) => error,
  );
  const second = api('/api/posts', { signal: b.signal });
  a.abort();
  expect(await first).toMatchObject({ name: 'AbortError' });
  expect(fetch.mock.calls).toHaveLength(1);
  response.resolve(Response.json({ items: ['visible'] }));
  expect(await second).toEqual({ items: ['visible'] });
});

it('abandons an unused read immediately and ignores its late unauthorized response', async () => {
  const old = deferred<Response>(),
    fresh = deferred<Response>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  vi.stubGlobal('fetch', fetch);
  const expired = vi.fn();
  const unsubscribe = onUnauthorized(expired);
  try {
    const controller = new AbortController();
    const first = api('/api/posts', { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    controller.abort();
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    const second = api('/api/posts');
    expect(fetch).toHaveBeenCalledTimes(2);
    old.resolve(Response.json({}, { status: 401 }));
    fresh.resolve(Response.json({ items: ['fresh'] }));
    expect(await second).toEqual({ items: ['fresh'] });
    expect(expired).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

it('does not share reads across a mutation start or completion', async () => {
  const before = deferred<Response>(),
    mutation = deferred<Response>(),
    during = deferred<Response>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(before.promise)
    .mockReturnValueOnce(mutation.promise)
    .mockReturnValueOnce(during.promise)
    .mockResolvedValueOnce(Response.json({ count: 2 }));
  vi.stubGlobal('fetch', fetch);
  const first = api('/api/posts/p');
  const write = api('/api/interactions/p/like', { method: 'PUT' });
  const middle = api('/api/posts/p');
  expect(fetch).toHaveBeenCalledTimes(3);
  mutation.resolve(Response.json({ count: 2 }));
  await write;
  expect(await api('/api/posts/p')).toEqual({ count: 2 });
  expect(fetch).toHaveBeenCalledTimes(4);
  before.resolve(Response.json({ count: 0 }));
  during.resolve(Response.json({ count: 1 }));
  await Promise.all([first, middle]);
});

it('never joins a previous account read or lets its failure sign out the new account', async () => {
  const old = deferred<Response>(),
    fresh = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise),
  );
  const unsubscribeOld = onUnauthorized(vi.fn());
  const first = api('/api/posts').catch((error: unknown) => error);
  unsubscribeOld();
  const expired = vi.fn();
  const unsubscribe = onUnauthorized(expired);
  try {
    const second = api('/api/posts');
    old.resolve(Response.json({}, { status: 401 }));
    expect(await first).toBeInstanceOf(ApiError);
    const third = api('/api/posts');
    expect(fetch).toHaveBeenCalledTimes(2);
    fresh.resolve(Response.json({ items: ['new-account'] }));
    expect(await second).toEqual({ items: ['new-account'] });
    expect(await third).toEqual({ items: ['new-account'] });
    expect(expired).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

it('bounds stalled shared reads even when transport ignores cancellation, then permits a fresh read', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(new Promise(() => {}))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const first = api('/api/posts').catch((error: unknown) => error);
  const second = api('/api/posts').catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await first).toBeInstanceOf(Error);
  expect(await second).toBeInstanceOf(Error);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(await api('/api/posts')).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps mutations, different URLs and custom GET options independent', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  await Promise.all([
    api('/api/posts?cursor=1'),
    api('/api/posts?cursor=2'),
    api('/api/posts', { method: 'POST' }),
    api('/api/posts', { method: 'POST' }),
    api('/api/posts', { headers: { 'X-Test': 'one' } }),
    api('/api/posts', { headers: { 'X-Test': 'two' } }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(6);
});
it('preserves HTTP status and notifies a mounted session once across concurrent failures', async () => {
  const expired = vi.fn();
  const unsubscribe = onUnauthorized(expired);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Sign in.' }, { status: 401 })),
  );
  try {
    const results = await Promise.allSettled([
      api('/api/posts'),
      api('/api/notifications'),
    ]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ApiError);
        expect(result.reason).toMatchObject({
          status: 401,
          message: 'Sign in.',
        });
      }
    }
    expect(expired).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});
it('ignores aborted and old-session failures after a new session subscribes', async () => {
  let reply!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    ),
  );
  const oldSession = vi.fn(),
    newSession = vi.fn();
  const unsubscribeOld = onUnauthorized(oldSession);
  const oldRequest = api('/api/posts').catch((error: unknown) => error);
  unsubscribeOld();
  const unsubscribeNew = onUnauthorized(newSession);
  try {
    reply(Response.json({}, { status: 401 }));
    expect(await oldRequest).toBeInstanceOf(ApiError);
    expect(oldSession).not.toHaveBeenCalled();
    expect(newSession).not.toHaveBeenCalled();
    const controller = new AbortController();
    const aborted = api('/api/posts', { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    controller.abort();
    reply(Response.json({}, { status: 401 }));
    expect(await aborted).toMatchObject({ name: 'AbortError' });
    expect(newSession).not.toHaveBeenCalled();
  } finally {
    unsubscribeNew();
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from './index';

afterEach(() => vi.unstubAllGlobals());
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
    expect(await aborted).toBeInstanceOf(ApiError);
    expect(newSession).not.toHaveBeenCalled();
  } finally {
    unsubscribeNew();
  }
});

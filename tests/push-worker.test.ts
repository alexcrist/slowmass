import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, expect, it, vi } from 'vitest';
// Execute event handlers in a Node VM with platform-boundary fakes, never a browser.
let handlers: Map<string, (event: unknown) => void>;
let showNotification: ReturnType<typeof vi.fn>;
let matchAll: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn>;
beforeEach(() => {
  handlers = new Map();
  showNotification = vi.fn(async () => {});
  matchAll = vi.fn(async () => []);
  openWindow = vi.fn(async () => {});
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL,
    self: {
      location: { origin: 'https://slowmass.com' },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
      skipWaiting: vi.fn(),
      registration: { showNotification },
      clients: { claim: vi.fn(), matchAll, openWindow },
    },
  });
});
async function emit(type: string, event: object) {
  let work: Promise<unknown> | undefined;
  handlers.get(type)!({
    ...event,
    waitUntil: (promise: Promise<unknown>) => {
      work = promise;
    },
  });
  await work;
}
it.each(['request:bob', 'follower:bob', 'joined:bob'])(
  'shows generic push %s without caching private content or changing read state',
  async (key) => {
    await emit('push', {
      data: {
        json: () => ({
          key,
          version: 9,
          subscriptionId: 'device',
          body: 'private text',
          url: 'https://evil.test',
        }),
      },
    });
    expect(showNotification).toHaveBeenCalledWith(
      'slowmass',
      expect.objectContaining({
        body: 'You have new activity. Open slowmass to see it.',
        tag: `slowmass:device:${key}`,
        data: { key, version: 9 },
        renotify: false,
      }),
    );
    expect(handlers.has('fetch')).toBe(false);
    expect([...handlers.keys()].sort()).toEqual([
      'activate',
      'install',
      'notificationclick',
      'push',
    ]);
  },
);
it.each(['comment:test', 'follower:bob', 'joined:bob'])(
  'opens %s in Activity and never accepts an external target',
  async (key) => {
    const focus = vi.fn(async () => {});
    const navigate = vi.fn(async () => ({ focus }));
    matchAll.mockResolvedValue([
      { url: 'https://slowmass.com/#feed', navigate },
    ]);
    const close = vi.fn();
    await emit('notificationclick', {
      notification: {
        data: { key, url: 'https://evil.test' },
        close,
      },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      `https://slowmass.com/#notifications/${key}`,
    );
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
    matchAll.mockResolvedValue([]);
    await emit('notificationclick', {
      notification: { data: { key: 'https://evil.test' }, close },
    });
    expect(openWindow).toHaveBeenCalledWith(
      'https://slowmass.com/#notifications',
    );
  },
);
it('still displays safe generic text if a provider delivers an empty or malformed payload', async () => {
  await emit('push', {
    data: {
      json: () => {
        throw new Error('Invalid JSON');
      },
    },
  });
  await emit('push', { data: { json: () => null } });
  expect(showNotification).toHaveBeenCalledTimes(2);
  expect(showNotification).toHaveBeenCalledWith(
    'slowmass',
    expect.objectContaining({ data: { key: '', version: 0 } }),
  );
});

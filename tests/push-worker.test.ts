import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dismissPushNotifications } from '../src/client/features/push/browser';
import { validNotificationKey } from '../src/server/features/notifications';
const eventKeys = [
  'event_response:00000000-0000-4000-8000-000000000001.bob',
  'event_message:00000000-0000-4000-8000-000000000002',
];
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
    MessageChannel,
    setTimeout,
    clearTimeout,
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
afterEach(() => vi.unstubAllGlobals());
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
it.each(['request:bob', 'follower:bob', 'joined:bob', ...eventKeys])(
  'shows the described push %s without caching content, following links, or changing read state',
  async (key) => {
    expect(validNotificationKey(key)).toBe(true);
    await emit('push', {
      data: {
        json: () => ({
          key,
          version: 9,
          subscriptionId: 'device',
          title: 'Dinner',
          body: 'Alice posted in Dinner.',
          url: 'https://evil.test',
        }),
      },
    });
    expect(showNotification).toHaveBeenCalledWith(
      'Dinner',
      expect.objectContaining({
        body: 'Alice posted in Dinner.',
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
it.each([{}, { title: 7, body: '   ' }, null])(
  'falls back to generic text for an older or malformed payload %j',
  async (payload) => {
    await emit('push', {
      data: { json: () => ({ ...payload, key: 'request:bob', version: 1 }) },
    });
    expect(showNotification).toHaveBeenCalledWith(
      'slowmass',
      expect.objectContaining({
        body: 'You have new activity. Open slowmass to see it.',
      }),
    );
  },
);
it.each([
  'comment:test',
  'thread_comment:00000000-0000-4000-8000-000000000003',
  'comment_like:00000000-0000-4000-8000-000000000003.bob',
  'follower:bob',
  'joined:bob',
  ...eventKeys,
])('opens %s in Activity and never accepts an external target', async (key) => {
  const focus = vi.fn(async () => {});
  const navigate = vi.fn(async () => ({ focus }));
  matchAll.mockResolvedValue([{ url: 'https://slowmass.com/#feed', navigate }]);
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
});
it('shows a new-photo alert under its own tag and opens the photo, not Activity', async () => {
  const key = 'post:00000000-0000-4000-8000-000000000003';
  // Post alerts never appear in Activity, so it cannot focus or acknowledge them.
  expect(validNotificationKey(key)).toBe(false);
  await emit('push', {
    data: { json: () => ({ key, version: 4, subscriptionId: 'device' }) },
  });
  expect(showNotification).toHaveBeenCalledWith(
    'slowmass',
    expect.objectContaining({
      tag: `slowmass:device:${key}`,
      data: { key, version: 4 },
    }),
  );
  await emit('notificationclick', {
    notification: { data: { key }, close: vi.fn() },
  });
  expect(openWindow).toHaveBeenCalledWith(
    'https://slowmass.com/#post/00000000-0000-4000-8000-000000000003',
  );
  await emit('notificationclick', {
    notification: { data: { key: 'post:../../evil' }, close: vi.fn() },
  });
  expect(openWindow).toHaveBeenLastCalledWith(
    'https://slowmass.com/#notifications',
  );
});
it.each([
  'event_response:00000000-0000-4000-8000-000000000001',
  'event_response:00000000-0000-4000-8000-000000000001.bob/../../feed',
  'event_message:invalid',
  'event_message:00000000-0000-4000-8000-000000000002:extra',
])('rejects malformed event identity %s at receipt and click', async (key) => {
  expect(validNotificationKey(key)).toBe(false);
  await emit('push', { data: { json: () => ({ key, version: 1 }) } });
  expect(showNotification).toHaveBeenCalledWith(
    'slowmass',
    expect.objectContaining({ data: { key: '', version: 1 } }),
  );
  await emit('notificationclick', {
    notification: { data: { key }, close: vi.fn() },
  });
  expect(openWindow).toHaveBeenCalledWith(
    'https://slowmass.com/#notifications',
  );
});
it('dismisses acknowledged event alerts without dismissing another event or a newer version', async () => {
  for (const [key, version] of [
    [eventKeys[0], 2],
    [eventKeys[0], 3],
    [eventKeys[1], 2],
  ])
    await emit('push', {
      data: { json: () => ({ key, version, subscriptionId: 'device' }) },
    });
  const notifications = showNotification.mock.calls.map(([, options]) => ({
    data: (options as { data: { key: string; version: number } }).data,
    close: vi.fn(),
  }));
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({
        getNotifications: async () => notifications,
      }),
    },
  });
  await dismissPushNotifications([{ key: eventKeys[0], version: 2 }]);
  expect(notifications[0].close).toHaveBeenCalledOnce();
  expect(notifications[1].close).not.toHaveBeenCalled();
  expect(notifications[2].close).not.toHaveBeenCalled();
});
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

it('prefers an installed window over a browser tab and falls back if it closes', async () => {
  const browserFocus = vi.fn();
  const browserNavigate = vi.fn(async () => ({ focus: browserFocus }));
  const appFocus = vi.fn();
  const appNavigate = vi.fn(async () => ({ focus: appFocus }));
  const browser = {
    url: 'https://slowmass.com/#feed',
    navigate: browserNavigate,
    postMessage: (_data: unknown, ports: MessagePort[]) =>
      ports[0].postMessage({ standalone: false }),
  };
  const installed = {
    url: 'https://slowmass.com/#profile',
    navigate: appNavigate,
    postMessage: (_data: unknown, ports: MessagePort[]) =>
      ports[0].postMessage({ standalone: true }),
  };
  matchAll.mockResolvedValue([browser, installed]);
  const event = {
    notification: { data: { key: 'comment:test' }, close: vi.fn() },
  };
  await emit('notificationclick', event);
  expect(appNavigate).toHaveBeenCalledWith(
    'https://slowmass.com/#notifications/comment:test',
  );
  expect(appFocus).toHaveBeenCalledOnce();
  expect(browserNavigate).not.toHaveBeenCalled();
  appNavigate.mockRejectedValueOnce(new Error('Closed'));
  await emit('notificationclick', event);
  expect(browserFocus).toHaveBeenCalledOnce();
  expect(openWindow).not.toHaveBeenCalled();
});
it('bounds a window probe ignored by an older client', async () => {
  vi.useFakeTimers();
  try {
    const focus = vi.fn();
    matchAll.mockResolvedValue([
      {
        url: 'https://slowmass.com/',
        postMessage: vi.fn(),
        navigate: vi.fn(async () => ({ focus })),
      },
    ]);
    const clicked = emit('notificationclick', {
      notification: { data: {}, close: vi.fn() },
    });
    // Timers inside the VM use the real boundary, captured when it was created.
    await clicked;
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PushSettings,
  clearLocalPush,
  dismissPushNotifications,
} from '../src/client/features/push';
import { InstallProvider } from '../src/client/features/install';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/client/api', () => ({ api: mock.api }));
let renderer: ReactTestRenderer;
let endpoint: string | null;
let local: typeof subscription | null;
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  toJSON: () => ({
    endpoint: subscription.endpoint,
    keys: { p256dh: 'key', auth: 'auth' },
  }),
  unsubscribe: vi.fn(),
};
let registration: {
  pushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  getNotifications: ReturnType<typeof vi.fn>;
};
let register: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
beforeEach(() => {
  endpoint = null;
  local = null;
  mock.api.mockReset();
  subscription.unsubscribe.mockReset().mockImplementation(async () => {
    local = null;
    return true;
  });
  mock.api.mockImplementation(async (_path: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      endpoint = subscription.endpoint;
      return { ok: true };
    }
    if (options?.method === 'DELETE') {
      endpoint = null;
      return { ok: true };
    }
    return {
      available: true,
      publicKey: 'BAAA',
      subscription: endpoint ? { id: 'one', endpoint } : null,
    };
  });
  registration = {
    pushManager: {
      getSubscription: vi.fn(async () => local),
      subscribe: vi.fn(async () => {
        local = subscription;
        return subscription;
      }),
    },
    getNotifications: vi.fn(async () => []),
  };
  register = vi.fn(async () => registration);
  requestPermission = vi.fn(async () => {
    Object.assign(Notification, { permission: 'granted' });
    return 'granted';
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('navigator', {
    userAgent: 'Desktop',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    serviceWorker: {
      getRegistration: vi.fn(async () => registration),
      register,
      ready: Promise.resolve(registration),
    },
  });
  const events = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(
      createElement(InstallProvider, { children: createElement(PushSettings) }),
    );
  });
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
async function click(label: string) {
  const button = renderer.root
    .findAllByType('button')
    .find((button) => button.children.join('') === label)!;
  expect(button).toBeDefined();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => button.props.onClick());
}
it('asks for permission only on explicit opt-in, saves it, and disables server delivery before browser cleanup', async () => {
  await mount();
  expect(text()).toContain('off for this device');
  expect(requestPermission).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  await click('Enable notifications');
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(requestPermission.mock.invocationCallOrder[0]).toBeLessThan(
    register.mock.invocationCallOrder[0],
  );
  expect(register).toHaveBeenCalledWith('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: expect.any(Uint8Array),
  });
  expect(mock.api).toHaveBeenCalledWith('/api/push', {
    method: 'PUT',
    body: JSON.stringify(subscription.toJSON()),
  });
  expect(text()).toContain('on for this device');
  await click('Disable notifications');
  expect(text()).toContain('off for this device');
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  const deleteIndex = mock.api.mock.calls.findIndex(
    (call) => call[1]?.method === 'DELETE',
  );
  expect(mock.api.mock.invocationCallOrder[deleteIndex]).toBeLessThan(
    subscription.unsubscribe.mock.invocationCallOrder[0],
  );
});
it('handles denied permission without registration or writes and explains how to recover', async () => {
  requestPermission.mockResolvedValue('denied');
  await mount();
  await click('Enable notifications');
  expect(register).not.toHaveBeenCalled();
  expect(mock.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  expect(text()).toContain('Notifications are blocked');
});
it('completes first opt-in after a slow Android permission dialog and focus return', async () => {
  vi.useFakeTimers();
  Object.assign(navigator, { userAgent: 'Android', platform: 'Linux armv8l' });
  await mount();
  let grant!: (permission: string) => void;
  requestPermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  await click('Enable notifications');
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(register).not.toHaveBeenCalled();
  expect(text()).toContain('Enabling…');
  expect(mock.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  await act(async () => {
    Object.assign(Notification, { permission: 'granted' });
    window.dispatchEvent(new Event('focus'));
    grant('granted');
  });
  expect(text()).toContain('on for this device');
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(
    mock.api.mock.calls.filter((call) => call[1]?.method === 'PUT'),
  ).toHaveLength(1);
});
it('shows failures without claiming success and allows retry after a failed server registration', async () => {
  await mount();
  const failure = 'Sign-in is temporarily unavailable. Please try again.';
  mock.api.mockRejectedValueOnce(new Error(failure));
  await click('Enable notifications');
  expect(text()).toContain(failure);
  expect(Notification.permission).toBe('granted');
  expect(text()).not.toContain('on for this device');
  await click('Retry');
  await click('Enable notifications');
  expect(text()).toContain('on for this device');
});
it('revokes server delivery even when browser cleanup fails', async () => {
  endpoint = subscription.endpoint;
  local = subscription;
  Object.assign(Notification, { permission: 'granted' });
  await mount();
  subscription.unsubscribe.mockRejectedValueOnce(new Error('Browser failed'));
  await click('Disable notifications');
  expect(endpoint).toBeNull();
  expect(text()).toContain('off for this device');
});
it('explains Home Screen installation on iPhone and iPad without asking for permission', async () => {
  Object.assign(navigator, {
    userAgent: 'Macintosh',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  await mount();
  expect(text()).toContain('add slowmass to your Home Screen');
  expect(mock.api).not.toHaveBeenCalled();
  expect(requestPermission).not.toHaveBeenCalled();
});
it('handles unsupported browsers without subscription requests', async () => {
  vi.stubGlobal('PushManager', undefined);
  await mount();
  expect(text()).toContain('aren’t supported');
  expect(mock.api).not.toHaveBeenCalled();
});
it('dismisses only acknowledged push versions and unsubscribes on sign-out', async () => {
  const seen = { data: { key: 'likes:one', version: 1 }, close: vi.fn() };
  const newer = { data: { key: 'likes:one', version: 2 }, close: vi.fn() };
  registration.getNotifications.mockResolvedValue([seen, newer]);
  await dismissPushNotifications([{ key: 'likes:one', version: 1 }]);
  expect(seen.close).toHaveBeenCalledOnce();
  expect(newer.close).not.toHaveBeenCalled();
  local = subscription;
  await clearLocalPush();
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  expect(newer.close).toHaveBeenCalledOnce();
});

it('ignores a stale status response after disabling and cancels opt-in when Settings unmounts', async () => {
  await mount();
  let resolveStatus!: (value: unknown) => void;
  const read = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  const implementation = mock.api.getMockImplementation()!;
  mock.api.mockImplementation((path: string, options?: RequestInit) =>
    options?.method ? implementation(path, options) : read,
  );
  await click('Enable notifications');
  await click('Disable notifications');
  await act(async () =>
    resolveStatus({
      available: true,
      publicKey: 'BAAA',
      subscription: { id: 'one', endpoint: subscription.endpoint },
    }),
  );
  expect(text()).toContain('off for this device');
  expect(
    renderer.root
      .findAllByType('button')
      .some((button) => button.children.join('') === 'Enable notifications'),
  ).toBe(true);
  let resolvePermission!: (permission: string) => void;
  requestPermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
  );
  register.mockClear();
  await click('Enable notifications');
  await act(async () => renderer.unmount());
  await act(async () => resolvePermission('granted'));
  expect(register).not.toHaveBeenCalled();
});

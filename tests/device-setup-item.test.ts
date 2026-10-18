import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DeviceSetupItem,
  useDeviceSetup,
} from '../src/client/features/device-setup';
import { InstallProvider } from '../src/client/features/install';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/client/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/api')>()),
  api: mock.api,
}));

let renderer: ReactTestRenderer;
let endpoint: string | null;
let local: typeof subscription | null;
let unseen: boolean;
let declineFailures: number;
let storage: Map<string, string>;
let observers: FakeObserver[];
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  toJSON: () => ({
    endpoint: subscription.endpoint,
    keys: { p256dh: 'key', auth: 'auth' },
  }),
  unsubscribe: vi.fn(),
};
let requestPermission: ReturnType<typeof vi.fn>;
class FakeObserver {
  observed = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe = (element: Element) => this.observed.add(element);
  unobserve = (element: Element) => this.observed.delete(element);
  disconnect = () => this.observed.clear();
  takeRecords = () => [];
  show() {
    this.callback(
      [...this.observed].map(
        (target) =>
          ({
            target,
            isIntersecting: true,
            intersectionRatio: 1,
          }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}
beforeEach(() => {
  endpoint = null;
  local = null;
  declineFailures = 0;
  storage = new Map();
  observers = [];
  mock.api.mockReset();
  mock.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/device-setup') {
      if (declineFailures-- > 0) throw new Error('Offline');
      return { pending: false };
    }
    if (options?.method === 'PUT') {
      endpoint = subscription.endpoint;
      return { ok: true };
    }
    return {
      available: true,
      publicKey: 'BAAA',
      subscription: endpoint ? { id: 'one', endpoint } : null,
    };
  });
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => local),
      subscribe: vi.fn(async () => {
        local = subscription;
        return subscription;
      }),
    },
    getNotifications: vi.fn(async () => []),
  };
  requestPermission = vi.fn(async () => {
    Object.assign(Notification, { permission: 'granted' });
    return 'granted';
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('navigator', {
    userAgent: 'Android',
    platform: 'Linux',
    maxTouchPoints: 5,
    standalone: false,
    serviceWorker: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
    querySelector: () => null,
  });
  vi.stubGlobal('window', {
    innerWidth: 390,
    innerHeight: 800,
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

function Harness({ pushSubscribed = false }: { pushSubscribed?: boolean }) {
  const setup = useDeviceSetup({ pending: true, pushSubscribed }, true);
  unseen = setup.unseen;
  return createElement('ul', null, createElement(DeviceSetupItem, { setup }));
}
async function mount(pushSubscribed = false) {
  if (renderer) await act(async () => renderer.unmount());
  await act(async () => {
    renderer = create(
      createElement(InstallProvider, {
        children: createElement(Harness, { pushSubscribed }),
      }),
      { createNodeMock: () => ({ showModal() {}, close() {} }) },
    );
  });
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
function rows() {
  return renderer.root.findAllByType('li');
}
async function click(label: string) {
  const button = renderer.root
    .findAllByType('button')
    .find(
      (button) =>
        button.props['aria-label'] === label ||
        button.children.join('') === label,
    );
  expect(button, `Button ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => button!.props.onClick());
}
function declines() {
  return mock.api.mock.calls.filter(([path]) => path === '/api/device-setup');
}
async function offerInstall(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn(async () => ({ outcome }));
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), { prompt }),
    );
  });
  return prompt;
}

it('offers Android notifications first, then installation, and treats a dismissed install prompt as No', async () => {
  await mount();
  expect(text()).toContain('Turn on notifications for follows');
  expect(text()).not.toContain('Install slowmass');
  expect(unseen).toBe(true);
  expect(requestPermission).not.toHaveBeenCalled();
  const prompt = await offerInstall('dismissed');
  expect(text()).toContain('Turn on notifications for follows');
  await click('Turn on');
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(endpoint).toBe(subscription.endpoint);
  expect(text()).toContain('Notifications are on.');
  expect(text()).toContain('Install slowmass on this device.');
  expect(unseen).toBe(true);
  await click('Install');
  expect(prompt).toHaveBeenCalledOnce();
  expect(declines()).toHaveLength(1);
  expect(declines()[0][1]).toMatchObject({ method: 'DELETE' });
  expect(rows()).toHaveLength(0);
  expect(unseen).toBe(false);
});

it('ends Android setup after notifications and an accepted installation', async () => {
  await mount();
  await offerInstall('accepted');
  await click('Turn on');
  await click('Install');
  expect(text()).toContain('Installation requested.');
  expect(renderer.root.findAllByType('button')).toHaveLength(0);
  expect(declines()).toHaveLength(0);
});

it('saves No for the account, keeps it retryable after failure, and stops asking', async () => {
  declineFailures = 1;
  await mount();
  await offerInstall('accepted');
  const dismiss = renderer.root.findByProps({
    'aria-label': 'Dismiss notification suggestion',
  });
  expect(dismiss.props.className).toBe('notification-dismiss');
  expect(text()).not.toContain('"No"');
  await click('Dismiss notification suggestion');
  expect(text()).toContain('Could not save your answer.');
  expect(rows()).toHaveLength(1);
  await click('Dismiss notification suggestion');
  expect(declines()).toHaveLength(2);
  expect(rows()).toHaveLength(0);
  expect(unseen).toBe(false);
  expect(requestPermission).not.toHaveBeenCalled();
});

it('treats blocking the permission prompt opened from the row as No', async () => {
  requestPermission.mockImplementation(async () => {
    Object.assign(Notification, { permission: 'denied' });
    return 'denied';
  });
  await mount();
  await offerInstall('accepted');
  await click('Turn on');
  expect(declines()).toHaveLength(1);
  expect(rows()).toHaveLength(0);
});

it('offers Android installation directly when notifications were blocked earlier', async () => {
  Object.assign(Notification, { permission: 'denied' });
  await mount();
  expect(rows()).toHaveLength(0);
  await offerInstall('accepted');
  expect(text()).toContain('Install slowmass on this device.');
  expect(requestPermission).not.toHaveBeenCalled();
  await click('Dismiss install suggestion');
  expect(declines()).toHaveLength(1);
  expect(rows()).toHaveLength(0);
});

it('guides an iPhone browser to the Home Screen without push work, unless push is on elsewhere', async () => {
  Object.assign(navigator, { userAgent: 'iPhone', platform: 'iPhone' });
  await mount();
  expect(text()).toContain(
    'To get notifications, first add slowmass to your Home Screen.',
  );
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await click('Show how');
  const dialog = renderer.root.findByType('dialog');
  expect(dialog.findAllByType('li')).toHaveLength(5);
  expect(text()).toContain('Add to Home Screen');
  expect(text()).toContain('Adding it is the first step');
  expect(text()).toContain('In Activity, tap');
  expect(text()).toContain('Already added it?');
  await click('Done');
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(rows()).toHaveLength(1);
  expect(mock.api).not.toHaveBeenCalled();
  expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
  await mount(true);
  expect(rows()).toHaveLength(0);
});

it('offers notifications in the iPhone Home Screen app and nothing once they are on', async () => {
  Object.assign(navigator, {
    userAgent: 'iPhone',
    platform: 'iPhone',
    standalone: true,
  });
  await mount();
  expect(text()).toContain('Turn on notifications for follows');
  await click('Turn on');
  expect(text()).toContain('Notifications are on.');
  expect(renderer.root.findAllByType('button')).toHaveLength(0);
  await mount();
  expect(rows()).toHaveLength(0);
});

it('shows nothing on desktop and makes no requests', async () => {
  Object.assign(navigator, {
    userAgent: 'Desktop',
    platform: 'MacIntel',
    maxTouchPoints: 0,
  });
  await mount();
  await offerInstall('accepted');
  expect(rows()).toHaveLength(0);
  expect(unseen).toBe(false);
  expect(mock.api).not.toHaveBeenCalled();
  expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
});

it('counts each step until its summary is visible for 250 ms on this device', async () => {
  await mount();
  expect(unseen).toBe(true);
  vi.useFakeTimers();
  await act(async () => observers.at(-1)!.show());
  await act(async () => vi.advanceTimersByTime(249));
  expect(unseen).toBe(true);
  await act(async () => vi.advanceTimersByTime(1));
  expect(unseen).toBe(false);
  expect(JSON.parse(storage.get('slowmass:device-setup-seen')!)).toEqual([
    'notifications',
  ]);
  vi.useRealTimers();
  await mount();
  expect(text()).toContain('Turn on notifications for follows');
  expect(unseen).toBe(false);
  storage.set('slowmass:device-setup-seen', 'not json');
  await mount();
  expect(unseen).toBe(true);
});

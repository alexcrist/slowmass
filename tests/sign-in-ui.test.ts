import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Welcome } from '../src/client/features/welcome/Welcome';
import { MemberApp } from '../src/client/features/people/MemberApp';

const auth = vi.hoisted(() => ({ magicLink: vi.fn() }));
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({ signIn: { magicLink: auth.magicLink } }),
}));
vi.mock('better-auth/client/plugins', () => ({ magicLinkClient: vi.fn() }));

type Request = {
  path: string;
  options?: RequestInit;
  settled: boolean;
  resolve: (response: Response) => void;
};
let requests: Request[];
let renderer: ReactTestRenderer;
const signedOut = { signInAvailable: true, user: null, profile: null };
const signedIn = {
  signInAvailable: true,
  user: { id: 'member', name: 'Member' },
  profile: null,
};
const token = 'b'.repeat(48);
const eventId = '12345678-1234-4234-8234-123456789abc';

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  auth.magicLink.mockReset().mockResolvedValue({ error: null });
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const location = {
    hash: '',
    search: '',
    pathname: '/',
    origin: 'https://slowmass.com',
    assign: vi.fn(),
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', location);
  vi.stubGlobal('navigator', { standalone: false });
  vi.stubGlobal('window', {
    location,
    history: { state: null, replaceState: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    scrollTo: vi.fn(),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    querySelector: () => null,
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
  });
  // The transport deliberately allows aborted reads to finish late.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (path: string, options?: RequestInit) =>
        new Promise<Response>((resolve) =>
          requests.push({ path, options, settled: false, resolve }),
        ),
    ),
  );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function pending(path = '/api/bootstrap') {
  const request = requests.find((item) => item.path === path && !item.settled);
  expect(request).toBeDefined();
  return request!;
}
async function reply(data: unknown, status = 200, request = pending()) {
  request.settled = true;
  await act(async () => request.resolve(Response.json(data, { status })));
}
async function emit(event: string) {
  await act(async () =>
    (event === 'visibilitychange' ? document : window).dispatchEvent(
      new Event(event),
    ),
  );
}
function button(label: string) {
  return renderer.root
    .findAllByType('button')
    .find(
      (node) =>
        node.props['aria-label'] === label || node.children.join('') === label,
    );
}
async function click(label: string) {
  const node = button(label);
  expect(node).toBeDefined();
  expect(node!.props.disabled).not.toBe(true);
  await act(async () => node!.props.onClick());
}
const confirmation = () =>
  renderer.root
    .findAllByType('h2')
    .some(
      (node) =>
        node.children.join('') === 'Open the sign-in link in your email.',
    );
async function requestLink(kind: 'regular' | 'invite' | 'event' = 'regular') {
  location.hash = kind === 'regular' ? '' : `#${kind}/${token}`;
  await act(async () => {
    renderer = create(createElement(Welcome));
  });
  await reply(signedOut);
  if (kind === 'invite')
    await reply({ available: true }, 200, pending('/api/invite-link/check'));
  if (kind === 'event')
    await reply(
      { event: { id: eventId, open: true } },
      200,
      pending('/api/event-link'),
    );
  await act(async () =>
    renderer.root
      .findByProps({ id: 'email' })
      .props.onChange({ target: { value: 'Guest@Example.com' } }),
  );
  const form = renderer.root.findByProps({ id: 'email' }).parent!.parent!;
  await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));
}

it.each(['regular', 'invite', 'event'] as const)(
  'simplifies %s confirmation and resumes on return',
  async (kind) => {
    await requestLink(kind);
    expect(confirmation()).toBe(true);
    expect(renderer.root.findByType('strong').children).toEqual([
      'guest@example.com',
    ]);
    expect(button('I’ve opened the email link')).toBeUndefined();
    expect(button('Try again')).toBeUndefined();
    expect(renderer.root.findAllByType('details')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ id: 'email' })).toHaveLength(0);
    await emit('focus');
    await emit('visibilitychange');
    expect(
      requests.filter((item) => item.path === '/api/bootstrap'),
    ).toHaveLength(2);
    await reply(signedIn);
    expect(renderer.root.findAllByType(MemberApp)).toHaveLength(1);
    expect(confirmation()).toBe(false);
    const count = requests.length;
    await emit('focus');
    expect(requests).toHaveLength(count);
  },
);

it('skips hidden checks, checks restored pages and reconnects, and never polls', async () => {
  await requestLink();
  Object.assign(document, { visibilityState: 'hidden' });
  await emit('focus');
  await emit('pageshow');
  await emit('visibilitychange');
  await emit('online');
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(requests).toHaveLength(1);
  Object.assign(document, { visibilityState: 'visible' });
  await emit('pageshow');
  await reply(signedOut);
  expect(button('Try again')).toBeUndefined();
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(requests).toHaveLength(2);
  await emit('online');
  await reply(signedIn);
  expect(renderer.root.findAllByType(MemberApp)).toHaveLength(1);
});

it('shows retry only after failed automatic checks and recovers without another email', async () => {
  await requestLink();
  await emit('focus');
  await reply({}, 503);
  expect(button('Try again')).toBeUndefined();
  await act(async () => vi.advanceTimersByTime(500));
  await reply({}, 503);
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('Couldn’t check sign-in');
  await click('Try again');
  expect(button('Try again')).toBeUndefined();
  await emit('focus');
  expect(
    requests.filter((request) => request.path === '/api/bootstrap'),
  ).toHaveLength(4);
  await reply(signedIn);
  expect(renderer.root.findAllByType(MemberApp)).toHaveLength(1);
  expect(auth.magicLink).toHaveBeenCalledOnce();
});

it('bounds stalled session checks and ignores their late signed-in responses', async () => {
  await requestLink();
  await emit('visibilitychange');
  const stale = pending();
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(stale.options?.signal?.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTime(500));
  const retry = requests
    .filter((request) => request.path === '/api/bootstrap')
    .at(-1)!;
  await reply(signedOut, 200, retry);
  await reply(signedIn, 200, stale);
  expect(confirmation()).toBe(true);
  expect(renderer.root.findAllByType(MemberApp)).toHaveLength(0);
});

it('aborts a pending resume check and removes listeners on unmount', async () => {
  await requestLink();
  await emit('focus');
  const request = pending();
  await act(async () => renderer.unmount());
  expect(request.options?.signal?.aborted).toBe(true);
  await reply(signedIn, 200, request);
  await emit('pageshow');
  await emit('online');
  expect(requests).toHaveLength(2);
});

it.each(['regular', 'invite', 'event'] as const)(
  'keeps installed-app %s recovery collapsed and resends the same request',
  async (kind) => {
    Object.assign(navigator, { standalone: true });
    await requestLink(kind);
    const help = renderer.root.findByType('details');
    expect(help.props.open).not.toBe(true);
    expect(help.findByType('summary').children).toEqual([
      'Trouble signing in?',
    ]);
    expect(
      help
        .findAllByType('button')
        .some((node) => node.children.join('') === 'Send a new link'),
    ).toBe(true);
    const original = auth.magicLink.mock.calls[0][0];
    expect(original.email).toBe('guest@example.com');
    if (kind === 'event')
      expect(original.metadata).toEqual({ eventLink: token });
    if (kind === 'invite')
      expect(original.metadata).toEqual({ inviteLink: token });
    let finish!: (result: { error: null }) => void;
    auth.magicLink.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const send = button('Send a new link')!;
    // Two activations in one render still send only once.
    await act(async () => {
      send.props.onClick();
      send.props.onClick();
    });
    expect(auth.magicLink).toHaveBeenCalledTimes(2);
    expect(button('Sending…')!.props.disabled).toBe(true);
    expect(auth.magicLink.mock.calls[1][0]).toEqual(original);
    await act(async () => finish({ error: null }));
    expect(help.findByProps({ role: 'status' }).children.join('')).toContain(
      'New link requested',
    );
    expect(renderer.root.findAllByProps({ id: 'email' })).toHaveLength(0);
  },
);

it('keeps recovery usable after a failed resend without changing the address', async () => {
  Object.assign(navigator, { standalone: true });
  await requestLink();
  auth.magicLink.mockResolvedValueOnce({
    error: { code: 'TOO_MANY_REQUESTS' },
  });
  await click('Send a new link');
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('Wait a minute and try again');
  expect(confirmation()).toBe(true);
  expect(button('Send a new link')!.props.disabled).toBe(false);
  await click('Send a new link');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(auth.magicLink.mock.calls.map(([request]) => request.email)).toEqual(
    Array(3).fill('guest@example.com'),
  );
});

it('supports display-mode installed apps and consumes pasted links inside that window', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  await requestLink();
  const input = renderer.root.findByProps({ id: 'login-link' });
  expect(input.props.type).toBe('password');
  await act(async () =>
    input.props.onChange({
      target: {
        value:
          'https://slowmass.com/api/auth/magic-link/verify?token=unused&callbackURL=https://outside.example',
      },
    }),
  );
  await act(async () =>
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
  expect(window.location.assign).toHaveBeenCalledWith(
    'https://slowmass.com/api/auth/magic-link/verify?token=unused&callbackURL=%2F&errorCallbackURL=%2F%3Ferror%3Dsignin',
  );
  expect(input.props.value).toBe('');
});

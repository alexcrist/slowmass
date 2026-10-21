import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Welcome } from '../src/client/features/welcome/Welcome';
import { MemberApp } from '../src/client/features/people/MemberApp';

const auth = vi.hoisted(() => ({ magicLink: vi.fn(), social: vi.fn() }));
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    signIn: { magicLink: auth.magicLink, social: auth.social },
  }),
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
  auth.social.mockReset();
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
async function openSignIn(
  kind: 'regular' | 'invite' | 'event' = 'regular',
  google = false,
) {
  location.hash = kind === 'regular' ? '' : `#${kind}/${token}`;
  await act(async () => {
    renderer = create(createElement(Welcome));
  });
  await reply({ ...signedOut, googleSignInAvailable: google });
  if (kind === 'invite')
    await reply({ available: true }, 200, pending('/api/invite-link/check'));
  if (kind === 'event')
    await reply(
      { event: { id: eventId, open: true } },
      200,
      pending('/api/event-link'),
    );
}
async function submitEmail() {
  await act(async () =>
    renderer.root
      .findByProps({ id: 'email' })
      .props.onChange({ target: { value: 'Guest@Example.com' } }),
  );
  const form = renderer.root.findByProps({ id: 'email' }).parent!.parent!;
  await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));
}
async function requestLink(kind: 'regular' | 'invite' | 'event' = 'regular') {
  await openSignIn(kind);
  await submitEmail();
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
    expect(JSON.stringify(renderer.toJSON())).toContain('hours.');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('10 minutes');
    expect(button('Send a new link')).toBeDefined();
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

it.each(
  (['regular', 'invite', 'event'] as const).flatMap((kind) =>
    [false, true].map((installed) => ({ kind, installed })),
  ),
)(
  'resends $kind with the same invitation (installed: $installed)',
  async ({ kind, installed }) => {
    Object.assign(navigator, { standalone: installed });
    await requestLink(kind);
    if (installed) {
      const help = renderer.root.findByType('details');
      expect(help.props.open).not.toBe(true);
      expect(help.findByType('summary').children).toEqual([
        'Trouble signing in?',
      ]);
      expect(help.findAllByProps({ type: 'button' })).toHaveLength(0);
    }
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
    expect(
      renderer.root.findByProps({ role: 'status' }).children.join(''),
    ).toContain('New link requested');
    expect(renderer.root.findAllByProps({ id: 'email' })).toHaveLength(0);
  },
);

it.each(['regular', 'invite', 'event'] as const)(
  'recovers an expired %s email link in a new browser after asking for the address',
  async (kind) => {
    location.search = '?error=INVALID_TOKEN';
    await openSignIn(kind);
    expect(auth.magicLink).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ id: 'email' }).props.value).toBe('');
    expect(
      renderer.root.findByProps({ role: 'alert' }).children.join(''),
    ).toContain('Enter your email below to send a new link');
    expect(button('Send a new link')!.props.type).toBe('submit');
    await submitEmail();
    expect(confirmation()).toBe(true);
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(auth.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'guest@example.com',
        ...(kind === 'regular'
          ? {}
          : {
              metadata:
                kind === 'invite'
                  ? { inviteLink: token }
                  : { eventLink: token },
            }),
      }),
    );
  },
);

it.each(['invite', 'event'] as const)(
  'keeps %s recovery usable when the invitation stops admitting people',
  async (kind) => {
    location.search = '?error=INVALID_TOKEN';
    await openSignIn(kind);
    auth.magicLink.mockResolvedValueOnce({
      error: { code: 'INVITATION_REQUIRED' },
    });
    await submitEmail();
    expect(confirmation()).toBe(false);
    expect(button('Send a new link')!.props.disabled).toBe(false);
    expect(
      renderer.root.findByProps({ role: 'alert' }).children.join(''),
    ).toContain(
      kind === 'invite'
        ? 'ask your friend for a new link'
        : 'ask the host for the current link',
    );
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

it('ignores a late resend confirmation after navigating to another invitation', async () => {
  await requestLink('invite');
  let finish!: (result: { error: null }) => void;
  auth.magicLink.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click('Send a new link');
  location.hash = `#event/${'c'.repeat(48)}`;
  await emit('hashchange');
  await reply(
    { event: { id: eventId, open: true } },
    200,
    pending('/api/event-link'),
  );
  await act(async () => finish({ error: null }));
  expect(confirmation()).toBe(false);
  expect(renderer.root.findAllByProps({ id: 'email' })).toHaveLength(1);
  await submitEmail();
  expect(auth.magicLink.mock.calls.at(-1)![0].metadata).toEqual({
    eventLink: 'c'.repeat(48),
  });
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

it.each(['regular', 'invite', 'event'] as const)(
  'starts Google from %s with the original invitation and no email requirement',
  async (kind) => {
    auth.social.mockResolvedValue({
      data: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',
      },
    });
    await openSignIn(kind, true);
    await click('Continue with Google');
    expect(auth.social).toHaveBeenCalledWith({
      provider: 'google',
      disableRedirect: true,
      ...(kind === 'regular'
        ? {}
        : {
            additionalData: {
              [kind === 'event' ? 'eventLink' : 'inviteLink']: token,
            },
          }),
    });
    expect(auth.magicLink).not.toHaveBeenCalled();
    expect(location.assign).toHaveBeenCalledOnce();
    expect(button('Continue with Google')!.props.disabled).toBe(true);
    await emit('pageshow');
    expect(button('Continue with Google')!.props.disabled).toBe(false);
  },
);

it('hides Google when unavailable and after choosing email', async () => {
  await openSignIn();
  expect(button('Continue with Google')).toBeUndefined();
  await act(async () => renderer.unmount());
  await openSignIn('invite', true);
  await submitEmail();
  expect(confirmation()).toBe(true);
  expect(button('Continue with Google')).toBeUndefined();
});

it('suppresses duplicate Google requests and restores both choices on failure', async () => {
  let resolve!: (value: unknown) => void;
  auth.social.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await openSignIn('regular', true);
  const onClick = button('Continue with Google')!.props.onClick;
  await act(async () => {
    onClick();
    onClick();
  });
  expect(auth.social).toHaveBeenCalledOnce();
  expect(renderer.root.findByProps({ id: 'email' }).props.disabled).toBe(true);
  await act(async () => resolve({ error: { code: 'FORBIDDEN' } }));
  expect(button('Continue with Google')!.props.disabled).toBe(false);
  expect(renderer.root.findByProps({ id: 'email' }).props.disabled).toBe(false);
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('Couldn’t start Google sign-in');
  expect(location.assign).not.toHaveBeenCalled();
});

it('ignores a Google response after navigating to a different invitation', async () => {
  let resolve!: (value: unknown) => void;
  auth.social.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await openSignIn('invite', true);
  await click('Continue with Google');
  location.hash = '#invite/' + 'c'.repeat(48);
  await emit('hashchange');
  await act(async () =>
    resolve({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=old' },
    }),
  );
  expect(location.assign).not.toHaveBeenCalled();
});

it('shows Google cancellation recovery without describing an expired email', async () => {
  location.search = '?auth=google&error=access_denied';
  await openSignIn('event', true);
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('Google sign-in wasn’t completed');
  expect(button('Continue with Google')).toBeDefined();
});

it('rejects an unexpected redirect destination', async () => {
  auth.social.mockResolvedValue({
    data: { url: 'https://example.com/not-google' },
  });
  await openSignIn('regular', true);
  await click('Continue with Google');
  expect(location.assign).not.toHaveBeenCalled();
  expect(button('Continue with Google')!.props.disabled).toBe(false);
});

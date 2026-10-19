import { act, createElement, type ReactElement } from 'react';
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Welcome } from '../src/client/features/welcome/Welcome';
import { MemberApp } from '../src/client/features/people/MemberApp';
import { HeaderActions } from '../src/client/features/people/MemberNavigation';
import { Notifications } from '../src/client/features/notifications/Notifications';
import { EventPage } from '../src/client/features/events/EventPage';
import { EditEvent } from '../src/client/features/events/EventForm';
import { fromZoned } from '../src/client/features/events/time';
import { AvatarForm } from '../src/client/features/avatars/AvatarForm';
import { EventPreview } from '../src/client/features/events/EventPreview';

const authMocks = vi.hoisted(() => ({ magicLink: vi.fn() }));
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    signIn: { magicLink: authMocks.magicLink },
    signOut: vi.fn(),
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
const id = '11111111-2222-4333-8444-555555555555';
const token = 'a'.repeat(48);
const startsAt = Date.UTC(2030, 0, 5, 3, 0);
const details = {
  id,
  title: 'Dinner',
  description: 'Bring a dish',
  location: '1 Main St',
  startsAt,
  endsAt: null,
  timeZone: 'America/Los_Angeles',
  width: 4,
  height: 3,
  cancelled: false,
  over: false,
  photoUrl: `/media/events/${id}`,
  thumbnailUrl: `/media/events/${id}?size=thumb`,
  hosts: [
    {
      handle: 'alice',
      displayName: 'Alice',
      hasAvatar: true,
      isCreator: true,
      isViewer: false,
    },
  ],
};
const url = `https://slowmass.com/#event/${token}`;
function view(overrides: Record<string, unknown> = {}) {
  return {
    ...details,
    counts: { going: 1, maybe: 0, declined: 0 },
    pendingHosts: [],
    url,
    viewer: { isHost: false, isCreator: false, response: null },
    ...overrides,
  };
}
const host = { isHost: true, isCreator: true, response: null };
beforeEach(() => {
  authMocks.magicLink.mockReset();
  requests = [];
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', {
    hash: '#feed',
    pathname: '/',
    search: '',
    href: 'https://slowmass.com/',
    origin: 'https://slowmass.com',
    reload: vi.fn(),
  });
  vi.stubGlobal('navigator', { standalone: false });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    scrollTo: vi.fn(),
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(element: ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
}
function visibleText(
  value:
    | ReactTestRendererJSON
    | ReactTestRendererJSON[]
    | string
    | null = renderer.toJSON(),
): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return (Array.isArray(value) ? value : (value.children ?? []))
    .map((child) => visibleText(child))
    .join(' ');
}
function pending(path: string) {
  const request = requests.find(
    (item) => item.path.startsWith(path) && !item.settled,
  );
  expect(request, `Pending request for ${path}`).toBeDefined();
  return request!;
}
async function reply(request: Request, data: unknown, status = 200) {
  request.settled = true;
  await act(async () => {
    request.resolve(Response.json(data, { status }));
  });
}
// The accessible name skips decoration hidden from assistive technology.
function labelText(value: ReactTestInstance | string): string {
  if (typeof value === 'string') return value;
  if (value.props['aria-hidden']) return '';
  return value.children.map(labelText).join(' ');
}
function button(label: string) {
  const found = renderer.root
    .findAllByType('button')
    .find(
      (item) =>
        item.props['aria-label'] === label ||
        item.children.map(labelText).join(' ').trim() === label,
    );
  expect(found, `Button ${label}`).toBeDefined();
  return found!;
}
async function click(label: string) {
  const target = button(label);
  expect(target.props.disabled).not.toBe(true);
  await act(async () => target.props.onClick());
}
async function type(id: string, value: string) {
  await act(async () =>
    renderer.root.findByProps({ id }).props.onChange({ target: { value } }),
  );
}
async function submit() {
  await act(async () =>
    renderer.root
      .findAllByType('form')
      .at(-1)!
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}

it('links available event avatars to profile setup for viewers without a photo', async () => {
  location.hash = `#event/${id}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'erin',
        displayName: 'Erin',
        bio: '',
        hasAvatar: 0,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(pending('/api/notifications/unread-count').path).toContain(
    'includeEvents=1',
  );
  await reply(pending(`/api/events/${id}`), {
    event: view({
      viewer: { isHost: false, isCreator: false, response: 'going' },
    }),
  });
  expect(visibleText()).toContain('Dinner');
  expect(visibleText()).toMatch(/Hosted by\s+Alice/);
  // Events stays in the main navigation instead of a back control.
  expect(visibleText()).not.toContain('Back to');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
  ).toHaveLength(1);
  await reply(pending(`/api/events/${id}/guests`), {
    items: [{ handle: 'bob_k3j9z', displayName: 'Bob', hasAvatar: false }],
    next: null,
  });
  expect(visibleText()).not.toContain('bob_k3j9z');
  const profileLinks = renderer.root
    .findAllByType('a')
    .filter(
      (link) =>
        String(link.props.href).startsWith('#profile') &&
        link.props['aria-label'] !== 'Profile',
    );
  expect(profileLinks).toHaveLength(1);
  expect(profileLinks[0].props.href).toBe('#profile/alice');
  expect(profileLinks[0].props['aria-label']).toBe('View Alice’s profile');
  await act(async () => {
    location.hash = profileLinks[0].props.href;
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(visibleText()).toContain('Choose your username');
  expect(
    requests.some((request) => request.path.startsWith('/api/people/alice')),
  ).toBe(false);
});

it('keeps Activity and Settings in the event-only phone header', async () => {
  const reselect = vi.fn();
  await mount(
    createElement(HeaderActions, {
      page: 'notifications',
      unreadCount: 3,
      eventOnly: true,
      onReselect: reselect,
    }),
  );
  const links = renderer.root.findAllByType('a');
  expect(links.map((link) => link.props.href)).toEqual([
    '#notifications',
    '#settings',
  ]);
  expect(links[0].props['aria-description']).toBe('3 unread notifications.');
  expect(
    renderer.root.findByProps({ className: 'nav-badge' }).children,
  ).toEqual(['3']);
  await act(async () =>
    links[0].props.onClick({
      button: 0,
      preventDefault: vi.fn(),
      defaultPrevented: false,
    }),
  );
  expect(reselect).toHaveBeenCalledOnce();
});

it('opens an event from its URL, then shows guests only after answering', async () => {
  location.hash = `#event/${token}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'bob',
        displayName: 'Bob',
        bio: '',
        hasAvatar: 1,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const opened = pending('/api/events/open');
  expect(JSON.parse(String(opened.options?.body))).toEqual({ token });
  await reply(opened, { id });
  await reply(pending(`/api/events/${id}`), {
    event: view({ counts: null }),
  });
  expect(visibleText()).toContain('RSVP to see who’s going');
  expect(visibleText()).toContain('Guests');
  expect(
    requests.some((request) => /\/guests|\/activity/.test(request.path)),
  ).toBe(false);
  expect(visibleText()).not.toContain('Back to');
  expect(button('Going').props['aria-pressed']).toBe(false);
  await click('Going');
  const answer = pending(`/api/events/${id}/response`);
  // Answering needs no credential once the event is open.
  expect(JSON.parse(String(answer.options?.body))).toEqual({
    status: 'going',
  });
  await reply(answer, { status: 'going' });
  await reply(pending(`/api/events/${id}`), {
    event: view({
      viewer: { isHost: false, isCreator: false, response: 'going' },
    }),
  });
  expect(button('Going').props['aria-pressed']).toBe(true);
  expect(visibleText()).toContain('Guests');
});

it('explains an unavailable link instead of showing an event', async () => {
  location.hash = `#event/${token}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'bob',
        displayName: 'Bob',
        bio: '',
        hasAvatar: 1,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(
    pending('/api/events/open'),
    { error: 'This event link isn’t available.' },
    404,
  );
  expect(visibleText()).toContain('This event link isn’t available.');
  expect(
    requests.some((request) => request.path.startsWith(`/api/events/${id}`)),
  ).toBe(false);
});

it('shows the shareable URL in the address bar', async () => {
  const replaceState = vi.fn();
  window.history = { state: null, replaceState } as unknown as History;
  location.hash = `#event/${id}`;
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view() });
  expect(replaceState).toHaveBeenCalledWith(null, '', `#event/${token}`);
});

it('shows a limited event preview and ties email sign-in to its link', async () => {
  location.hash = `#event/${token}`;
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  const check = pending('/api/event-link');
  expect(JSON.parse(String(check.options?.body))).toEqual({ token });
  await reply(check, {
    event: {
      id,
      open: true,
      preview: {
        title: 'Dinner',
        date: 'Friday, January 4, 2030',
        width: 4,
        height: 3,
      },
    },
  });
  expect(visibleText()).toContain('Dinner');
  expect(visibleText()).toContain('Friday, January 4, 2030');
  expect(visibleText()).toContain('Enter your email to see details and RSVP');
  expect(visibleText()).not.toContain('Bring a dish');
  expect(visibleText()).not.toContain('1 Main St');
  expect(visibleText()).not.toContain('Alice');
  const cover = pending('/api/event-link/photo');
  expect(JSON.parse(String(cover.options?.body))).toEqual({ token });
  expect(
    requests.some(
      (request) =>
        request.path.startsWith('/media/') ||
        request.path.startsWith('/api/events'),
    ),
  ).toBe(false);
  await type('email', 'Erin@Example.com ');
  authMocks.magicLink.mockResolvedValue({ error: null });
  await submit();
  expect(authMocks.magicLink).toHaveBeenCalledWith({
    email: 'erin@example.com',
    callbackURL: `/#event/${id}`,
    errorCallbackURL: '/?error=event',
    metadata: { eventLink: token },
  });
  expect(visibleText()).toContain('Open the sign-in link in your email.');
});

it('falls back to normal sign-in for a link that no longer works', async () => {
  location.hash = `#event/${token}`;
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  await reply(pending('/api/event-link'), { event: null });
  expect(visibleText()).toContain('This event link isn’t available');
  await type('email', 'bob@example.com');
  authMocks.magicLink.mockResolvedValue({ error: null });
  await submit();
  expect(authMocks.magicLink).toHaveBeenCalledWith({
    email: 'bob@example.com',
    callbackURL: '/',
    errorCallbackURL: '/?error=signin',
  });
});

it('describes event activity and links to the event', async () => {
  await mount(createElement(Notifications, {}));
  const page = pending('/api/notifications');
  expect(page.path).toContain('includeEvents=1');
  await reply(page, {
    items: [
      {
        key: `event_response:${id}.bob`,
        kind: 'event_response',
        eventId: id,
        eventTitle: 'Dinner',
        handle: 'bob_q1',
        displayName: 'Bob B',
        response: 'maybe',
        version: 1,
        unread: true,
        createdAt: 1,
      },
      {
        key: 'event_message:m',
        kind: 'event_message',
        eventId: id,
        eventTitle: 'Dinner',
        handle: 'alice',
        displayName: 'Alice',
        messageKind: 'changed',
        body: 'time,location',
        version: 2,
        unread: false,
        createdAt: 2,
      },
    ],
    next: null,
  });
  // Guests never choose usernames, so event activity shows names.
  expect(visibleText()).toContain('Bob B might go to Dinner.');
  expect(visibleText()).not.toContain('bob_q1');
  expect(visibleText()).toContain(
    'Alice changed the time and location of Dinner.',
  );
  expect(
    renderer.root
      .findAllByProps({ className: 'notification-post' })
      .map((link) => link.props.href),
  ).toEqual([`#event/${id}`, `#event/${id}`]);
});

it('edits details in the event time zone with a retry-safe change ID', async () => {
  const saved = vi.fn();
  await mount(createElement(EditEvent, { id, onSaved: saved }));
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: host }),
  });
  expect(renderer.root.findByProps({ id: 'event-date' }).props.value).toBe(
    '2030-01-04',
  );
  expect(renderer.root.findByProps({ id: 'event-start' }).props.value).toBe(
    '19:00',
  );
  await type('event-start', '20:30');
  await type('event-end', '01:00');
  await submit();
  const patch = pending(`/api/events/${id}`);
  const body = JSON.parse(String(patch.options?.body));
  expect(patch.options?.method).toBe('PATCH');
  expect(body).toMatchObject({
    title: 'Dinner',
    startsAt: fromZoned('2030-01-04', '20:30', 'America/Los_Angeles'),
    // An end before the start finishes the next day.
    endsAt: fromZoned('2030-01-05', '01:00', 'America/Los_Angeles'),
    timeZone: 'America/Los_Angeles',
  });
  expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/);
  await reply(patch, { ok: true });
  expect(saved).toHaveBeenCalledWith(id);
});

it('shows the event link with a copy button from the mail icon', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { standalone: false, clipboard: { writeText } });
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  // Guests can share the one URL too.
  await reply(pending(`/api/events/${id}`), { event: view() });
  expect(visibleText()).not.toContain('Share link');
  await click('Share event link');
  expect(visibleText()).toContain(
    'Send the link to your friends to invite them.',
  );
  expect(
    renderer.root.findByProps({ 'aria-label': 'Event link' }).props.value,
  ).toBe(url);
  await click('Copy');
  expect(writeText).toHaveBeenCalledWith(url);
  expect(visibleText()).toContain('Link copied.');

  await act(async () => renderer.unmount());
  requests = [];
  vi.stubGlobal('navigator', { standalone: false });
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view() });
  await click('Share event link');
  await click('Copy');
  expect(visibleText()).toContain('Couldn’t copy the link.');
});

it('lets hosts answer and add hosts by email', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  // Hosts see the guests and activity.
  await reply(pending(`/api/events/${id}/guests`), { items: [], next: null });
  await reply(pending(`/api/events/${id}/activity`), { items: [], next: null });
  await click('Maybe');
  expect(
    JSON.parse(String(pending(`/api/events/${id}/response`).options?.body)),
  ).toEqual({ status: 'maybe' });
  await reply(pending(`/api/events/${id}/response`), { status: 'maybe' });
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: { ...host, response: 'maybe' } }),
  });
  expect(button('Maybe').props['aria-pressed']).toBe(true);
  expect(
    renderer.root
      .findAllByType('button')
      .some((item) => item.props.children === 'Replace link'),
  ).toBe(false);

  await click('Event options');
  await click('Edit hosts');
  // The creator always hosts, so there is nothing to remove yet.
  expect(visibleText()).not.toContain('Remove');
  const email = renderer.root.findByProps({ type: 'email' });
  await act(async () =>
    email.props.onChange({ target: { value: 'bob@example.com' } }),
  );
  await submit();
  const added = pending(`/api/events/${id}/hosts`);
  expect(added.options?.method).toBe('POST');
  expect(JSON.parse(String(added.options?.body))).toEqual({
    email: 'bob@example.com',
  });
  await reply(added, { ok: true });
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: host, pendingHosts: ['bob@example.com'] }),
  });
  expect(visibleText()).toContain('bob@example.com');
  expect(visibleText()).toContain('Pending');
  await click('Remove bob@example.com');
  const removed = pending(`/api/events/${id}/hosts`);
  expect(removed.options?.method).toBe('DELETE');
  expect(JSON.parse(String(removed.options?.body))).toEqual({
    email: 'bob@example.com',
  });
});

it('asks members a host added by email to accept hosting', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), {
    event: view({
      counts: null,
      viewer: {
        isHost: false,
        isCreator: false,
        hostInvited: true,
        response: null,
      },
    }),
  });
  expect(visibleText()).toContain('You’ve been asked to host this event.');
  await click('Become a host');
  const accepted = pending(`/api/events/${id}/hosting`);
  expect(accepted.options?.method).toBe('POST');
  await reply(accepted, { ok: true });
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  expect(visibleText()).not.toContain('asked to host');
});

it('puts the message composer below the event activity', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: { ...host, response: 'going' } }),
  });
  await reply(pending(`/api/events/${id}/activity`), {
    items: [],
    next: null,
  });
  const text = visibleText();
  expect(text.indexOf('No activity yet.')).toBeGreaterThan(-1);
  const section = renderer.root.findByProps({
    'aria-labelledby': `activity-${id}`,
  });
  const order = section
    .findAll((node) => typeof node.type === 'string')
    .filter((node) => node.type === 'p' || node.type === 'form')
    .map((node) => node.type);
  expect(order.indexOf('p')).toBeLessThan(order.indexOf('form'));
});

it('lets members without a photo change just their name', async () => {
  location.hash = '#edit';
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'alex_c_k3j9z',
        displayName: 'Alex',
        bio: '',
        hasAvatar: 0,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(renderer.root.findAllByProps({ id: 'handle' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ id: 'bio' })).toHaveLength(0);
  expect(visibleText()).not.toContain('alex_c_k3j9z');
  await type('display-name', 'Alex C');
  await submit();
  const save = pending('/api/people/self');
  expect(JSON.parse(String(save.options?.body))).toEqual({
    displayName: 'Alex C',
    bio: '',
  });
  await reply(save, {
    profile: {
      handle: 'alex_c_k3j9z',
      displayName: 'Alex C',
      bio: '',
      hasAvatar: 0,
    },
  });
  expect(location.hash).toBe('#settings');
});

it.each(['feed', 'people', 'compose', 'profile/erin'])(
  'gates %s without private reads and resumes it after photo setup',
  async (destination) => {
    location.hash = `#event/${id}`;
    await mount(
      createElement(MemberApp, {
        initialProfile: {
          handle: 'erin',
          displayName: 'Erin',
          bio: '',
          hasAvatar: 0,
        },
        onSignOut: vi.fn(),
        signingOut: false,
      }),
    );
    await reply(pending(`/api/events/${id}`), {
      event: view({ counts: null }),
    });
    const nav = renderer.root.findByProps({ 'aria-label': 'Main navigation' });
    expect(nav.findAllByProps({ className: 'nav-lock' })).toHaveLength(0);
    expect(nav.findAllByType('img')).toHaveLength(0);
    const target = nav
      .findAllByType('a')
      .find(
        (link) =>
          link.props.href === `#${destination}` &&
          link.props.className === 'nav-link',
      )!;
    expect(target.props['aria-description']).toContain('Set up your username');
    const before = requests.length;
    await act(async () => {
      location.hash = `#${destination}`;
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(visibleText()).toContain('Choose your username');
    expect(visibleText()).toContain('follow requests need your approval');
    expect(renderer.root.findAllByType(AvatarForm)).toHaveLength(0);
    const back = renderer.root.findByProps({
      className: 'text-button setup-return',
    });
    expect(back.props.href).toBe(`#event/${id}`);
    expect(requests.slice(before)).toEqual([]);
    await type('handle', 'erin_photos');
    await submit();
    const username = pending('/api/people/self');
    expect(JSON.parse(String(username.options?.body))).toEqual({
      handle: 'erin_photos',
      displayName: 'Erin',
      bio: '',
    });
    await reply(username, {
      profile: {
        handle: 'erin_photos',
        displayName: 'Erin',
        bio: '',
        hasAvatar: 0,
      },
    });
    await act(async () => window.dispatchEvent(new Event('hashchange')));
    expect(visibleText()).toContain('Add a profile photo');
    expect(button('Add profile photo')).toBeDefined();
    // AvatarForm's callback fires only after its upload succeeds.
    await act(async () =>
      renderer.root.findByType(AvatarForm).props.onChange(),
    );
    expect(location.hash).toBe(
      destination.startsWith('profile/')
        ? '#profile/erin_photos'
        : `#${destination}`,
    );
    expect(
      renderer.root.findAllByProps({ className: 'nav-lock' }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType(AvatarForm)).toHaveLength(0);
    expect(visibleText()).not.toContain('Choose your username');
  },
);

it('lets members leave setup for their event without changing access', async () => {
  location.hash = `#event/${id}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'erin',
        displayName: 'Erin',
        bio: '',
        hasAvatar: 0,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending(`/api/events/${id}`), { event: view({ counts: null }) });
  await act(async () => {
    location.hash = '#compose';
    window.dispatchEvent(new Event('hashchange'));
  });
  const href = renderer.root.findByProps({
    className: 'text-button setup-return',
  }).props.href;
  await act(async () => {
    location.hash = href;
    window.dispatchEvent(new Event('hashchange'));
  });
  await reply(pending(`/api/events/${id}`), { event: view({ counts: null }) });
  expect(visibleText()).toContain('RSVP to see who’s going');
  expect(renderer.root.findAllByProps({ className: 'nav-lock' })).toHaveLength(
    0,
  );
});

it('retries a failed preview cover and releases its in-memory URL on unmount', async () => {
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:preview');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await mount(
    createElement(EventPreview, {
      token,
      preview: { title: 'Dinner', date: 'Friday', width: 4, height: 3 },
    }),
  );
  await reply(pending('/api/event-link/photo'), {}, 503);
  expect(visibleText()).toContain('Couldn’t load the event photo');
  await click('Try photo again');
  const request = pending('/api/event-link/photo');
  request.settled = true;
  await act(async () =>
    request.resolve(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/webp' },
      }),
    ),
  );
  expect(createUrl).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('img').props.src).toBe('blob:preview');
  await act(async () => renderer.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});

it('links available avatars in host, guest, activity, and host-dialog sections', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  const people = [
    { handle: 'bob', displayName: 'Bob', hasAvatar: true },
    { handle: 'carol', displayName: 'Carol', hasAvatar: false },
  ];
  await reply(pending(`/api/events/${id}/guests`), {
    items: people,
    next: null,
  });
  await reply(pending(`/api/events/${id}/activity`), {
    items: people.map((person) => ({
      ...person,
      key: person.handle,
      kind: 'response',
      id: null,
      status: 'going',
      body: '',
      createdAt: Date.now(),
      canDelete: false,
    })),
    next: null,
  });
  const avatarLinks = () =>
    renderer.root
      .findAllByType('a')
      .filter((link) => link.props.className === 'event-person-link');
  expect(avatarLinks().map((link) => link.props.href)).toEqual([
    '#profile/alice',
    '#profile/bob',
    '#profile/bob',
  ]);
  expect(
    avatarLinks().every((link) => link.props['aria-label'].startsWith('View ')),
  ).toBe(true);
  expect(
    renderer.root.findAllByProps({ className: 'event-person-initial' }),
  ).toHaveLength(2);
  await click('Event options');
  await click('Edit hosts');
  expect(
    avatarLinks().filter((link) => link.props.href === '#profile/alice'),
  ).toHaveLength(2);
});

it('opens the authorized event cover in the shared photo modal and closes it', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ counts: null }) });
  expect(
    renderer.root.findAllByProps({ className: 'image-viewer' }),
  ).toHaveLength(0);
  expect(button('Enlarge event photo').props['aria-haspopup']).toBe('dialog');
  await click('Enlarge event photo');
  expect(button('Enlarge event photo').props['aria-expanded']).toBe(true);
  const photo = renderer.root.findByProps({ className: 'image-viewer-photo' });
  expect(photo.props.src).toBe(`/media/events/${id}`);
  expect(photo.props.alt).toBe('Cover photo for Dinner');
  expect(photo.props.width).toBe(4);
  expect(photo.props.height).toBe(3);
  expect(visibleText()).toContain('Loading event photo');
  await act(async () => photo.props.onLoad());
  expect(visibleText()).not.toContain('Loading event photo');
  await click('Close event photo');
  expect(
    renderer.root.findAllByProps({ className: 'image-viewer' }),
  ).toHaveLength(0);
  expect(button('Enlarge event photo').props['aria-expanded']).toBe(false);
});

it('keeps username conflicts in setup and preserves another member’s destination', async () => {
  location.hash = '#profile/alice';
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'erin',
        displayName: 'Erin',
        bio: '',
        hasAvatar: 0,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(visibleText()).toContain('Choose your username');
  await type('handle', 'alice');
  await submit();
  await reply(
    pending('/api/people/self'),
    { error: 'That username is unavailable. Choose another.' },
    409,
  );
  expect(visibleText()).toContain('That username is unavailable');
  expect(renderer.root.findByProps({ id: 'handle' }).props.value).toBe('alice');
  expect(renderer.root.findAllByType(AvatarForm)).toHaveLength(0);
  await type('handle', 'erin_photos');
  await submit();
  await reply(pending('/api/people/self'), {
    profile: {
      handle: 'erin_photos',
      displayName: 'Erin',
      bio: '',
      hasAvatar: 0,
    },
  });
  expect(location.hash).toBe('#profile/alice');
  await act(async () => renderer.root.findByType(AvatarForm).props.onChange());
  expect(location.hash).toBe('#profile/alice');
  expect(pending('/api/people/alice')).toBeDefined();
});

import { act, createElement, type ReactElement } from 'react';
import {
  create,
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
  hosts: [{ handle: 'alice', displayName: 'Alice', hasAvatar: true }],
};
const url = `https://slowmass.com/#event/${token}`;
function view(overrides: Record<string, unknown> = {}) {
  return {
    ...details,
    counts: { going: 1, maybe: 0, declined: 0 },
    link: { id: 'version', url },
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
function button(label: string) {
  const found = renderer.root
    .findAllByType('button')
    .find(
      (item) =>
        item.props['aria-label'] === label ||
        visibleText(item.children as ReactTestRendererJSON[]).trim() ===
          label ||
        item.children.join('') === label,
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

it('shows members without a photo the event, with guests linked only by name', async () => {
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
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
  ).toHaveLength(0);
  await reply(pending(`/api/events/${id}/guests`), {
    items: [{ handle: 'bob_k3j9z', displayName: 'Bob', hasAvatar: false }],
    next: null,
  });
  expect(visibleText()).not.toContain('bob_k3j9z');
  expect(
    renderer.root
      .findAllByType('a')
      .filter((link) => String(link.props.href).startsWith('#profile')),
  ).toHaveLength(0);
});

it('puts Activity and, for event-only members, Settings in the header', async () => {
  const reselect = vi.fn();
  await mount(
    createElement(HeaderActions, {
      page: 'notifications',
      unreadCount: 3,
      settings: true,
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
  expect(visibleText()).toContain('Answer to see who’s going');
  expect(visibleText()).not.toContain('Guests');
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

it('explains a replaced link instead of showing an event', async () => {
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

it('asks signed-out link holders only for an email, tied to the event link', async () => {
  location.hash = `#event/${token}`;
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  const check = pending('/api/event-link');
  expect(JSON.parse(String(check.options?.body))).toEqual({ token });
  await reply(check, { event: { id, open: true } });
  expect(visibleText()).toContain('You’re invited to an event');
  // Nothing about the event is requested or shown before sign-in.
  expect(visibleText()).not.toContain('Dinner');
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
  expect(visibleText()).toContain('Check your email');
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

it('shares the event link from the share sheet, or copies it', async () => {
  const shareSheet = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { standalone: false, share: shareSheet });
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await click('Share link');
  expect(shareSheet).toHaveBeenCalledWith({ title: 'Dinner', url });
  expect(visibleText()).not.toContain('Link copied.');

  await act(async () => renderer.unmount());
  requests = [];
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { standalone: false, clipboard: { writeText } });
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  // Guests can share the one URL too.
  await reply(pending(`/api/events/${id}`), { event: view() });
  await click('Share link');
  expect(writeText).toHaveBeenCalledWith(url);
  expect(visibleText()).toContain('Link copied.');
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

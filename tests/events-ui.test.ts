import { mockUploads } from './support/upload';
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
import { EditEvent, EventForm } from '../src/client/features/events/EventForm';
import { PostCropEditor, fullPhoto } from '../src/client/features/posts';
import {
  clockTime,
  eventWhen,
  fromZoned,
  zoneName,
} from '../src/client/features/events/time';
import { AvatarForm } from '../src/client/features/avatars/AvatarForm';
import { EventPreview } from '../src/client/features/events/EventPreview';
import { EventHostRow } from '../src/client/features/events/EventSummary';
import {
  originalAppearance,
  fontPairings,
} from '../src/shared/event-appearance';
import { pairings, palettes } from '../src/client/features/events/appearance';
import { appearanceDocument } from './support/appearance-document';

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
  appearance: originalAppearance,
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
const url = `https://slowmass.com/event/${token}`;
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
  mockUploads((path, options) => fetch(path, options));
  authMocks.magicLink.mockReset();
  requests = [];
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  const { root, themeColor } = appearanceDocument();
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
    documentElement: root,
    visibilityState: 'visible',
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    querySelector: vi.fn((selector: string) =>
      selector === 'meta[name="theme-color"]' ? themeColor : null,
    ),
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
function pending(path: string, method?: string) {
  const request = requests.find(
    (item) =>
      item.path.startsWith(path) &&
      !item.settled &&
      (!method || item.options?.method === method),
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
  return value.children.map(labelText).filter(Boolean).join(' ');
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
// The editor has its own Cancel beside the dialog's.
async function cancelDialog() {
  const cancel = renderer.root
    .findByType('dialog')
    .findAllByType('button')
    .find((item) => item.children.join('') === 'Cancel');
  expect(cancel, 'Dialog Cancel').toBeDefined();
  await act(async () => cancel!.props.onClick());
}
// The picker fields' native inputs, rather than their wrappers.
function nativeInput(id: string) {
  const found = renderer.root
    .findAllByProps({ id })
    .find((item) => item.type === 'input');
  expect(found, `Input ${id}`).toBeDefined();
  return found!;
}
async function submit() {
  await act(async () =>
    renderer.root
      .findAllByType('form')
      .at(-1)!
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}

async function chooseAppearance(name: string, value: string) {
  await act(async () =>
    renderer.root
      .findAllByType('input')
      .find(
        (input) => input.props.name === name && input.props.value === value,
      )!
      .props.onChange(),
  );
}
const rootStyle = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

it('previews creation appearance locally and preserves it through cover retries', async () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })),
  );
  const saved = vi.fn();
  await mount(
    createElement(EventForm, { hosts: [], onSaved: saved, onCancel: vi.fn() }),
  );
  await type('event-title', 'Dinner');
  await type('event-date', '2030-01-04');
  await type('event-start', '19:00');
  await click('Color theme');
  await chooseAppearance('event-color', 'wine');
  expect(rootStyle('--paper')).toBe(palettes.wine.paper);
  await cancelDialog();
  expect(rootStyle('--paper')).toBe(palettes.original.paper);
  await click('Color theme');
  await chooseAppearance('event-color', 'evergreen');
  await submit();
  await click('Fonts');
  await chooseAppearance('event-font', 'fascinate-inline');
  await submit();
  const appearance = {
    colorTheme: 'evergreen',
    fontPairing: 'fascinate-inline',
  };
  expect(rootStyle('--paper')).toBe(palettes.evergreen.paper);
  expect(rootStyle('--heading-font')).toBe(
    pairings['fascinate-inline'].heading,
  );
  expect(renderer.root.findByProps({ id: 'event-title' }).props.value).toBe(
    'Dinner',
  );
  expect(requests).toHaveLength(0);
  await click('Fonts');
  await chooseAppearance('event-font', 'classic');
  await act(async () =>
    renderer.root
      .findByType('dialog')
      .props.onCancel({ preventDefault: vi.fn() }),
  );
  expect(rootStyle('--heading-font')).toBe(
    pairings['fascinate-inline'].heading,
  );

  const file = new File(['synthetic photo'], 'cover.webp', {
    type: 'image/webp',
  });
  await act(async () =>
    renderer.root.findByProps({ id: 'event-photo' }).props.onChange({
      target: { files: [file], value: '' },
    }),
  );
  await act(async () =>
    renderer.root.findByType(PostCropEditor).props.onApply(file, fullPhoto),
  );
  await submit();
  const first = pending('/api/events', 'POST');
  const body = JSON.parse(String(first.options?.body));
  expect(body).toMatchObject({ title: 'Dinner', appearance });
  await reply(first, { id: body.id, state: 'pending' });
  const photo = pending(`/api/events/${body.id}/photo`);
  await reply(photo, { error: 'Try uploading again.' }, 503);
  expect(saved).not.toHaveBeenCalled();
  await submit();
  const retry = pending('/api/events', 'POST');
  expect(retry.options?.body).toBe(first.options?.body);
  await reply(retry, { id: body.id, state: 'pending' });
  const retryPhoto = pending(`/api/events/${body.id}/photo`);
  expect(retryPhoto.options?.headers).toEqual(photo.options?.headers);
  await reply(retryPhoto, { error: 'Try uploading again.' }, 503);

  await click('Color theme');
  await chooseAppearance('event-color', 'pool');
  await submit();
  await submit();
  const changed = pending('/api/events', 'POST');
  const changedBody = JSON.parse(String(changed.options?.body));
  expect(changedBody.id).not.toBe(body.id);
  expect(changedBody.appearance).toEqual({ ...appearance, colorTheme: 'pool' });
  await reply(changed, { id: changedBody.id, state: 'pending' });
  const changedPhoto = pending(`/api/events/${changedBody.id}/photo`);
  expect(changedPhoto.options?.headers).not.toEqual(photo.options?.headers);
  await reply(changedPhoto, { ok: true });
  expect(saved).toHaveBeenCalledExactlyOnceWith(changedBody.id);
  expect(requests.some((request) => request.path.endsWith('/appearance'))).toBe(
    false,
  );
  await act(async () => renderer.unmount());
  expect(rootStyle('--paper')).toBe('');
  expect(rootStyle('--heading-font')).toBe('');
});

it('edits colors and fonts in separate dialogs without losing event details', async () => {
  await mount(
    createElement(EditEvent, { id, onSaved: vi.fn(), onCancel: vi.fn() }),
  );
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await type('event-title', 'Unsaved dinner title');
  await type('event-location', 'Unsaved location');
  await click('Color theme');
  expect(renderer.root.findAllByProps({ name: 'event-font' })).toHaveLength(0);
  await chooseAppearance('event-color', 'wine');
  expect(rootStyle('--paper')).toBe(palettes.wine.paper);
  expect(rootStyle('--surface')).toBe(palettes.wine.surface);
  expect(rootStyle('--line')).toBe(palettes.wine.line);
  expect(rootStyle('--control-line')).toBe(palettes.wine.controlLine);
  expect(rootStyle('--heading-font')).toBe(pairings.original.heading);
  expect(requests.some((request) => request.path.endsWith('/appearance'))).toBe(
    false,
  );
  await cancelDialog();
  expect(rootStyle('--paper')).toBe('#ffffff');
  await click('Fonts');
  expect(renderer.root.findAllByProps({ name: 'event-color' })).toHaveLength(0);
  const previews = renderer.root.findAllByProps({
    className: 'appearance-font',
  });
  expect(previews).toHaveLength(7);
  for (const [index, pairing] of fontPairings.entries()) {
    const title = previews[index].findByType('strong');
    expect(title.children).toEqual([pairings[pairing].name]);
    expect(title.props.style).toEqual({
      fontFamily: pairings[pairing].heading,
      fontWeight: pairings[pairing].headingWeight,
    });
    expect(previews[index].findAllByType('small')).toHaveLength(0);
  }
  for (const pairing of fontPairings) {
    await chooseAppearance('event-font', pairing);
    expect(rootStyle('--heading-font')).toBe(pairings[pairing].heading);
    expect(rootStyle('--heading-weight')).toBe(
      String(pairings[pairing].headingWeight),
    );
  }
  await cancelDialog();
  expect(rootStyle('--heading-font')).toBe(pairings.original.heading);
  await click('Color theme');
  await chooseAppearance('event-color', 'evergreen');
  await submit();
  await submit();
  const save = pending(`/api/events/${id}/appearance`);
  const color = { colorTheme: 'evergreen', fontPairing: 'original' };
  expect(JSON.parse(String(save.options?.body))).toEqual({
    appearance: color,
    expected: originalAppearance,
  });
  expect(
    requests.filter((request) => request.path.endsWith('/appearance')),
  ).toHaveLength(1);
  expect(button('Saving…').props.disabled).toBe(true);
  await reply(save, { appearance: color });
  expect(rootStyle('--paper')).toBe(palettes.evergreen.paper);
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await click('Fonts');
  await chooseAppearance('event-font', 'fascinate-inline');
  await submit();
  const fonts = pending(`/api/events/${id}/appearance`);
  const appearance = {
    colorTheme: 'evergreen',
    fontPairing: 'fascinate-inline',
  };
  expect(JSON.parse(String(fonts.options?.body))).toEqual({
    appearance,
    expected: color,
  });
  await reply(fonts, { appearance });
  expect(rootStyle('--heading-font')).toBe(
    pairings['fascinate-inline'].heading,
  );
  expect(renderer.root.findByProps({ id: 'event-title' }).props.value).toBe(
    'Unsaved dinner title',
  );
  expect(renderer.root.findByProps({ id: 'event-location' }).props.value).toBe(
    'Unsaved location',
  );
  expect(
    requests.filter(
      (request) =>
        request.path === `/api/events/${id}` &&
        request.options?.method === 'PATCH',
    ),
  ).toHaveLength(0);
  await act(async () => renderer.unmount());
  expect(rootStyle('--paper')).toBe('');
  expect(rootStyle('--surface')).toBe('');
  expect(rootStyle('--heading-font')).toBe('');
});

it('keeps failed appearance edits retryable and aborts saves when editing unmounts', async () => {
  await mount(
    createElement(EditEvent, { id, onSaved: vi.fn(), onCancel: vi.fn() }),
  );
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await click('Color theme');
  await chooseAppearance('event-color', 'after-hours');
  await submit();
  const first = pending(`/api/events/${id}/appearance`);
  await reply(first, { error: 'The event changed. Reload it.' }, 409);
  expect(visibleText()).toContain('The event changed. Reload it.');
  expect(rootStyle('--paper')).toBe('#202544');
  expect(button('Save color theme').props.disabled).toBe(false);
  await submit();
  const retry = pending(`/api/events/${id}/appearance`);
  expect(retry.options?.body).toBe(first.options?.body);
  await act(async () => renderer.unmount());
  expect(retry.options?.signal?.aborted).toBe(true);
  expect(rootStyle('--paper')).toBe('');
  await reply(retry, {
    appearance: { colorTheme: 'after-hours', fontPairing: 'original' },
  });
  expect(rootStyle('--paper')).toBe('');
});

it('reloads conflicting appearance without dropping the event draft and uses the new save guard', async () => {
  await mount(
    createElement(EditEvent, { id, onSaved: vi.fn(), onCancel: vi.fn() }),
  );
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await type('event-description', 'Keep this unfinished description');
  await click('Fonts');
  await chooseAppearance('event-font', 'classic');
  await submit();
  await reply(
    pending(`/api/events/${id}/appearance`),
    { error: 'The event changed. Reload it.' },
    409,
  );
  await click('Reload appearance');
  expect(button('Loading…').props.disabled).toBe(true);
  const current = { colorTheme: 'pool', fontPairing: 'bungee-shade' };
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: host, appearance: current }),
  });
  expect(rootStyle('--paper')).toBe(palettes.pool.paper);
  expect(rootStyle('--heading-font')).toBe(pairings['bungee-shade'].heading);
  await chooseAppearance('event-font', 'fascinate-inline');
  await submit();
  const save = pending(`/api/events/${id}/appearance`);
  const appearance = { colorTheme: 'pool', fontPairing: 'fascinate-inline' };
  expect(JSON.parse(String(save.options?.body))).toEqual({
    appearance,
    expected: current,
  });
  await reply(save, { appearance });
  expect(
    renderer.root.findByProps({ id: 'event-description' }).props.value,
  ).toBe('Keep this unfinished description');
});

it.each([
  { viewer: { ...host, isHost: false } },
  { viewer: host, cancelled: true },
])(
  'keeps appearance editing unavailable for an ineligible editor: %j',
  async (event) => {
    await mount(
      createElement(EditEvent, { id, onSaved: vi.fn(), onCancel: vi.fn() }),
    );
    await reply(pending(`/api/events/${id}`), { event: view(event) });
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    expect(rootStyle('--paper')).toBe('');
  },
);

it('moves appearance out of the event menu and themes the edit page until navigation away', async () => {
  location.hash = `#event/${id}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'alice',
        displayName: 'Alice',
        bio: '',
        hasAvatar: 1,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const event = view({
    viewer: host,
    appearance: { colorTheme: 'cherry', fontPairing: 'handwritten' },
  });
  await reply(pending(`/api/events/${id}`), { event });
  await reply(pending(`/api/events/${id}/guests`), { items: [], next: null });
  await reply(pending(`/api/events/${id}/activity`), { items: [], next: null });
  await click('Event options');
  expect(visibleText()).not.toContain('Appearance');
  await click('Edit event');
  await act(async () => window.dispatchEvent(new Event('hashchange')));
  await reply(pending(`/api/events/${id}`), { event });
  expect(button('Color theme')).toBeDefined();
  expect(button('Fonts')).toBeDefined();
  expect(rootStyle('--paper')).toBe(palettes.cherry.paper);
  expect(rootStyle('--heading-font')).toBe(pairings.handwritten.heading);
  await act(async () => {
    location.hash = '#events';
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(rootStyle('--paper')).toBe('');
  expect(rootStyle('--surface')).toBe('');
});

it('restores ordinary app styling on navigation and uses the next event’s own pairing', async () => {
  location.hash = `#event/${id}`;
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
  await reply(pending(`/api/events/${id}`), {
    event: view({
      counts: null,
      appearance: { colorTheme: 'wine', fontPairing: 'classic' },
    }),
  });
  expect(rootStyle('--heading-font')).toContain('Fraunces');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Event options' }),
  ).toHaveLength(0);
  await act(async () => {
    location.hash = '#settings';
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(rootStyle('--heading-font')).toBe('');
  expect(
    document.documentElement.getAttribute('data-event-appearance'),
  ).toBeNull();
  const other = '22222222-3333-4444-8555-666666666666';
  await act(async () => {
    location.hash = `#event/${other}`;
    window.dispatchEvent(new Event('hashchange'));
  });
  await reply(pending(`/api/events/${other}`), {
    event: view({
      id: other,
      counts: null,
      appearance: { colorTheme: 'pool', fontPairing: 'bungee-shade' },
    }),
  });
  expect(rootStyle('--paper')).toBe('#e5f3ff');
  expect(rootStyle('--heading-font')).toContain('Bungee Shade');
});

it('themes only the current authorized signed-out preview and clears it on leaving the link', async () => {
  location.hash = `#event/${token}`;
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  await reply(pending('/api/event-link'), {
    event: {
      id,
      open: true,
      preview: {
        title: 'Dinner',
        date: 'Friday',
        width: 4,
        height: 3,
        appearance: { colorTheme: 'candlelight', fontPairing: 'monoton' },
      },
    },
  });
  expect(rootStyle('--paper')).toBe('#33211e');
  expect(rootStyle('--heading-font')).toContain('Monoton');
  expect(rootStyle('--body-font')).toBe('');
  await act(async () => {
    location.hash = '';
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(rootStyle('--paper')).toBe('');
  expect(rootStyle('--heading-font')).toBe('');
  expect(renderer.root.findAllByType(EventPreview)).toHaveLength(0);
});

it('opens profile previews from event avatars and gates following for viewers without a photo', async () => {
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
  await reply(pending('/api/people/alice'), {
    profile: {
      handle: 'alice',
      displayName: 'Alice',
      bio: null,
      relationship: 'none',
    },
  });
  expect(visibleText()).toMatch(/@\s*alice/);
  expect(visibleText()).toContain('This account is private');
  expect(visibleText()).not.toContain('Set up your account');
  expect(
    renderer.root.findByProps({ className: 'back-control' }).props.href,
  ).toBe(`#event/${id}`);
  expect(
    requests.some((request) => request.path.startsWith('/api/posts')),
  ).toBe(false);
  await click('Request to follow');
  expect(visibleText()).toContain('Set up your account');
  expect(
    renderer.root.findByProps({ className: 'button-link' }).props.href,
  ).toBe(`#event/${id}`);
  expect(
    requests.some((request) => request.path === '/api/people/alice/request'),
  ).toBe(false);
});

it('lets event-only members browse, paginate, search, and open profiles from Find', async () => {
  location.hash = '#people';
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
  expect(
    renderer.root.findByProps({ 'aria-label': 'Find' }).props[
      'aria-description'
    ],
  ).toBeUndefined();
  expect(visibleText()).not.toContain('Set up your account');
  const first = pending('/api/people/discover');
  const seed = new URL(first.path, location.origin).searchParams.get('seed');
  const cursor = `0:${'a'.repeat(32)}`;
  await reply(first, { items: [{ handle: 'alice' }], next: cursor });
  await click('Next');
  const second = pending('/api/people/discover');
  const params = new URL(second.path, location.origin).searchParams;
  expect(params.get('seed')).toBe(seed);
  expect(params.get('after')).toBe(cursor);
  await reply(second, { items: [{ handle: 'bob' }], next: null });
  vi.useFakeTimers();
  try {
    await type('find-person', 'alc');
    await act(async () => vi.advanceTimersByTimeAsync(350));
  } finally {
    vi.useRealTimers();
  }
  const search = pending('/api/people/discover');
  expect(new URL(search.path, location.origin).searchParams.get('q')).toBe(
    'alc',
  );
  await reply(search, { items: [{ handle: 'alice' }], next: null });
  const link = renderer.root
    .findAllByType('a')
    .find((item) => item.props.href === '#profile/alice')!;
  await act(async () => {
    location.hash = link.props.href;
    window.dispatchEvent(new Event('hashchange'));
  });
  await reply(pending('/api/people/alice'), {
    profile: {
      handle: 'alice',
      displayName: 'Alice',
      bio: null,
      relationship: 'none',
    },
  });
  expect(button('Request to follow')).toBeDefined();
  expect(
    renderer.root.findByProps({ className: 'back-control' }).props.href,
  ).toBe('#people');
  expect(
    requests.some((request) => request.path.startsWith('/api/posts')),
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
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Share event link' }),
  ).toHaveLength(0);
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
  expect(button('Going').props['aria-expanded']).toBe(false);
  expect(button('Maybe').props.disabled).toBe(true);
  const mutations = requests.filter((request) =>
    request.path.endsWith('/response'),
  ).length;
  await click('Going');
  expect(button('Going').props['aria-pressed']).toBe(true);
  expect(button('Going').props['aria-expanded']).toBe(true);
  expect(button('Maybe').props.disabled).toBe(false);
  expect(
    requests.filter((request) => request.path.endsWith('/response')),
  ).toHaveLength(mutations);
  await click('Maybe');
  const changed = pending(`/api/events/${id}/response`);
  expect(JSON.parse(String(changed.options?.body))).toEqual({
    status: 'maybe',
  });
  await reply(
    changed,
    { error: 'Could not save your answer. Try again.' },
    503,
  );
  expect(button('Going').props['aria-pressed']).toBe(true);
  expect(button('Going').props['aria-expanded']).toBe(true);
  expect(button('Maybe').props.disabled).toBe(false);
  await click('Maybe');
  await reply(pending(`/api/events/${id}/response`), { status: 'maybe' });
  expect(button('Maybe').props['aria-pressed']).toBe(true);
  expect(button('Maybe').props['aria-expanded']).toBe(false);
  expect(button('Going').props.disabled).toBe(true);
  expect(visibleText()).toContain('Guests');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Share event link' }),
  ).toHaveLength(0);
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
  expect(replaceState).toHaveBeenCalledWith(null, '', `/event/${token}`);
});

it.each(['path', 'fragment'])(
  'shows a limited event preview and ties email sign-in to its %s link',
  async (kind) => {
    location.hash = kind === 'fragment' ? `#event/${token}` : '';
    location.pathname = kind === 'path' ? `/event/${token}` : '/';
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
  },
);

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
        messageKind: 'message',
        body: 'Bring a jacket',
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
  expect(visibleText()).toContain('Alice posted in Dinner.');
  expect(visibleText()).toContain('Bring a jacket');
  expect(
    renderer.root
      .findAllByProps({ className: 'notification-post' })
      .map((link) => link.props.href),
  ).toEqual([`#event/${id}`, `#event/${id}`]);
});

it('edits details silently in the event time zone', async () => {
  const saved = vi.fn();
  await mount(
    createElement(EditEvent, { id, onSaved: saved, onCancel: vi.fn() }),
  );
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: host }),
  });
  const cover = renderer.root.findByProps({ alt: 'Current event cover photo' });
  expect(cover.props.src).toBe(details.photoUrl);
  expect(cover.props.width).toBe(details.width);
  expect(cover.props.height).toBe(details.height);
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
  expect(body.messageId).toBeUndefined();
  expect(visibleText()).not.toMatch(/notif(?:y|ies|ication)/i);
  await reply(patch, { ok: true });
  expect(saved).toHaveBeenCalledWith(id);
});

it('creates an event on a preview of its page, edited in place', async () => {
  location.hash = '#new-event';
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'alice',
        displayName: 'Alice',
        bio: '',
        hasAvatar: 1,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  // Cancel at the bottom replaces the back control.
  expect(renderer.root.findAllByProps({ className: 'back-control' })).toEqual(
    [],
  );
  expect(visibleText()).toContain('Add cover photo');
  expect(visibleText()).toContain('Choose a date');
  expect(visibleText()).toContain('Choose a start time');
  expect(visibleText()).toMatch(/Hosted by\s+Alice/);
  // Leaving the editor from a host avatar would drop the draft.
  expect(
    renderer.root.findAllByProps({ className: 'event-person-link' }),
  ).toHaveLength(0);
  // The end time waits for a start time.
  expect(renderer.root.findAllByProps({ id: 'event-end' })).toHaveLength(0);
  await type('event-title', 'Dinner\nparty');
  expect(renderer.root.findByProps({ id: 'event-title' }).props.value).toBe(
    'Dinner party',
  );
  await submit();
  expect(visibleText()).toContain('Choose a date and start time.');
  // Selecting the date opens the native picker, as do Enter and Space.
  const showPicker = vi.fn();
  const date = nativeInput('event-date');
  await act(async () => date.props.onClick({ currentTarget: { showPicker } }));
  const enter = {
    key: 'Enter',
    preventDefault: vi.fn(),
    currentTarget: { showPicker },
  };
  await act(async () => date.props.onKeyDown(enter));
  expect(enter.preventDefault).toHaveBeenCalledOnce();
  expect(showPicker).toHaveBeenCalledTimes(2);
  // Without picker support, the focused field still takes typed input.
  await act(async () =>
    date.props.onClick({
      currentTarget: {
        showPicker: () => {
          throw new Error('Unsupported');
        },
      },
    }),
  );
  await type('event-date', '2030-01-04');
  await type('event-start', '19:00');
  await type('event-end', '01:00');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = fromZoned('2030-01-04', '19:00', timeZone)!;
  expect(visibleText()).toContain(
    eventWhen({ startsAt: start, endsAt: null, timeZone }).date,
  );
  expect(visibleText()).toContain(clockTime('19:00'));
  expect(visibleText()).toContain(clockTime('01:00'));
  expect(visibleText()).toContain('next day');
  expect(visibleText()).toContain(zoneName(start, timeZone));
  await click('Remove end time');
  expect(nativeInput('event-end').props.value).toBe('');
  expect(visibleText()).toContain('End time');
  expect(visibleText()).not.toContain('next day');
  expect(button('Create event')).toBeDefined();
  await click('Cancel');
  expect(location.hash).toBe('#events');
});

it('edits an event on its page and cancels back to it', async () => {
  location.hash = `#event/${id}/edit`;
  await mount(
    createElement(MemberApp, {
      initialProfile: {
        handle: 'alice',
        displayName: 'Alice',
        bio: '',
        hasAvatar: 1,
      },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  expect(renderer.root.findAllByProps({ className: 'back-control' })).toEqual(
    [],
  );
  expect(visibleText()).toContain(eventWhen(details).date);
  expect(visibleText()).toMatch(/Hosted by\s+Alice/);
  expect(
    renderer.root.findByProps({ id: 'event-photo' }).props['aria-label'],
  ).toBe('Change cover photo');
  expect(button('Save')).toBeDefined();
  await click('Cancel');
  expect(location.hash).toBe(`#event/${id}`);
  expect(requests.some((request) => request.options?.method === 'PATCH')).toBe(
    false,
  );
});

it.each([true, false])(
  'lets a host (creator: %s) send a notification with retry-safe text and clear delivery guidance',
  async (isCreator) => {
    await mount(createElement(EventPage, { id, linkProfiles: true }));
    await reply(pending(`/api/events/${id}`), {
      event: view({ viewer: { ...host, isCreator } }),
    });
    await reply(pending(`/api/events/${id}/activity`), {
      items: [],
      next: null,
    });
    await click('Event options');
    await click('Send notification');
    expect(visibleText()).toContain('everyone who RSVP’d');
    expect(visibleText()).toContain(
      'Only people with push notifications enabled receive a push alert.',
    );
    expect(visibleText()).toContain('No email is sent.');
    expect(button('Send notification').props.disabled).toBe(true);
    const field = renderer.root.findByType('dialog').findByType('textarea');
    await type(field.props.id, 'Bring a jacket');
    await submit();
    const first = pending(`/api/events/${id}/notifications`);
    expect(first.options?.method).toBe('POST');
    expect(JSON.parse(String(first.options?.body))).toMatchObject({
      id: expect.any(String),
      body: 'Bring a jacket',
    });
    expect(button('Sending…').props.disabled).toBe(true);
    await submit();
    expect(
      requests.filter((request) => request.path.endsWith('/notifications')),
    ).toHaveLength(1);
    await reply(first, { error: 'Connection interrupted. Try again.' }, 503);
    expect(visibleText()).toContain('Connection interrupted. Try again.');
    expect(
      renderer.root.findByType('dialog').findByType('textarea').props.value,
    ).toBe('Bring a jacket');
    await submit();
    const retry = pending(`/api/events/${id}/notifications`);
    expect(retry.options?.body).toBe(first.options?.body);
    await reply(retry, { id: JSON.parse(String(first.options?.body)).id });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(visibleText()).toContain('Notification sent.');
    expect(pending(`/api/events/${id}/activity`)).toBeDefined();
  },
);

it('starts a new notification attempt when its message changes after failure', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await click('Event options');
  await click('Send notification');
  const fieldId = renderer.root.findByType('dialog').findByType('textarea')
    .props.id;
  await type(fieldId, 'First update');
  await submit();
  const first = pending(`/api/events/${id}/notifications`);
  await reply(first, { error: 'Try again.' }, 503);
  await type(fieldId, 'Corrected update');
  await submit();
  const corrected = pending(`/api/events/${id}/notifications`);
  expect(JSON.parse(String(corrected.options?.body)).id).not.toBe(
    JSON.parse(String(first.options?.body)).id,
  );
});

it.each([
  { viewer: { isHost: false, isCreator: false, response: 'going' } },
  {
    viewer: {
      isHost: false,
      isCreator: false,
      response: null,
      hostInvited: true,
    },
  },
  { viewer: host, cancelled: true },
])(
  'withholds the host notification control when unavailable: %j',
  async (overrides) => {
    await mount(createElement(EventPage, { id, linkProfiles: true }));
    await reply(pending(`/api/events/${id}`), { event: view(overrides) });
    if (overrides.viewer.isCreator) await click('Event options');
    else
      expect(
        renderer.root.findAllByProps({ 'aria-label': 'Event options' }),
      ).toHaveLength(0);
    expect(visibleText()).not.toContain('Send notification');
  },
);

it.each([
  { cancelled: false, over: false },
  { cancelled: true, over: false },
  { cancelled: false, over: true },
])(
  'keeps creator deletion available with confirmation for %j',
  async (state) => {
    await mount(createElement(EventPage, { id, linkProfiles: true }));
    await reply(pending(`/api/events/${id}`), {
      event: view({ viewer: host, ...state }),
    });
    await click('Event options');
    if (state.cancelled)
      expect(
        renderer.root.findAllByProps({ role: 'menuitem' }).map(labelText),
      ).toEqual(['Delete event']);
    await click('Delete event');
    expect(visibleText()).toContain('removes the event for everyone');
    expect(visibleText()).toContain('Guests won’t be notified');
    expect(requests.filter((r) => r.options?.method === 'DELETE')).toHaveLength(
      0,
    );
    await click('Cancel');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(requests.filter((r) => r.options?.method === 'DELETE')).toHaveLength(
      0,
    );
  },
);

it('excludes deletion from co-host controls', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: { ...host, isCreator: false } }),
  });
  await click('Event options');
  expect(visibleText()).toContain('Cancel event');
  expect(visibleText()).not.toContain('Delete event');
});

it('blocks duplicate deletion, preserves failures for retry, and returns to Events only after success', async () => {
  location.hash = `#event/${id}`;
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), {
    event: view({ viewer: host, cancelled: true }),
  });
  await click('Event options');
  await click('Delete event');
  const confirm = button('Delete event');
  await act(async () => {
    confirm.props.onClick();
    confirm.props.onClick();
  });
  expect(requests.filter((r) => r.options?.method === 'DELETE')).toHaveLength(
    1,
  );
  expect(button('Cancel').props.disabled).toBe(true);
  expect(button('Saving…').props.disabled).toBe(true);
  await reply(
    pending(`/api/events/${id}`, 'DELETE'),
    { error: 'Could not delete. Try again.' },
    503,
  );
  expect(location.hash).toBe(`#event/${id}`);
  expect(visibleText()).toContain('Could not delete. Try again.');
  await click('Delete event');
  await reply(pending(`/api/events/${id}`, 'DELETE'), { ok: true });
  expect(location.hash).toBe('#events');
});

it('does not redirect after leaving while deletion is pending', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  await click('Event options');
  await click('Delete event');
  await click('Delete event');
  const request = pending(`/api/events/${id}`, 'DELETE');
  await act(async () => renderer.unmount());
  location.hash = '#settings';
  expect(request.options?.signal?.aborted).toBe(true);
  await reply(request, { ok: true });
  expect(location.hash).toBe('#settings');
});

it.each([
  ['creator', true],
  ['co-host', false],
] as const)(
  'shows the event link with a copy button for the %s',
  async (_, isCreator) => {
    const viewer = { ...host, isCreator };
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { standalone: false, clipboard: { writeText } });
    await mount(createElement(EventPage, { id, linkProfiles: true }));
    await reply(pending(`/api/events/${id}`), { event: view({ viewer }) });
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
    await reply(pending(`/api/events/${id}`), { event: view({ viewer }) });
    await click('Share event link');
    await click('Copy');
    expect(visibleText()).toContain('Couldn’t copy the link.');
  },
);

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
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Share event link' }),
  ).toHaveLength(0);
  await click('Become a host');
  const accepted = pending(`/api/events/${id}/hosting`);
  expect(accepted.options?.method).toBe('POST');
  await reply(accepted, { ok: true });
  await reply(pending(`/api/events/${id}`), { event: view({ viewer: host }) });
  expect(visibleText()).not.toContain('asked to host');
  expect(button('Share event link')).toBeDefined();
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

it('shows a new member the event preview with a name field, then the event once named', async () => {
  location.hash = `#event/${id}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: null,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending(`/api/events/${id}`), {
    event: view({
      counts: null,
      appearance: { colorTheme: 'cherry', fontPairing: 'handwritten' },
    }),
  });
  // The signed-out preview's content, with a name field instead of email.
  expect(visibleText()).toContain('Dinner');
  expect(visibleText()).toContain(eventWhen(details).date);
  expect(
    renderer.root.findByProps({ alt: 'Cover photo for Dinner' }).props.src,
  ).toBe(details.photoUrl);
  expect(rootStyle('--paper')).toBe(palettes.cherry.paper);
  expect(visibleText()).toContain('Enter your name to see details and RSVP.');
  expect(visibleText()).toContain('Hosts and other guests see this name.');
  expect(visibleText()).not.toContain('What’s your name?');
  expect(
    renderer.root
      .findByProps({ className: 'joined-field' })
      .findByProps({ id: 'display-name' }).type,
  ).toBe('input');
  expect(button('Continue').props.type).toBe('submit');
  // Details wait for a name.
  expect(visibleText()).not.toContain('Bring a dish');
  expect(visibleText()).not.toContain('1 Main St');
  expect(visibleText()).not.toMatch(/Hosted by/);
  expect(renderer.root.findAllByProps({ 'aria-label': 'Your answer' })).toEqual(
    [],
  );
  await type('display-name', 'Bob');
  await submit();
  const save = pending('/api/people/self');
  expect(JSON.parse(String(save.options?.body))).toEqual({
    displayName: 'Bob',
    bio: '',
  });
  await reply(save, {
    profile: { handle: 'bob_k3j9z', displayName: 'Bob', bio: '', hasAvatar: 0 },
  });
  expect(location.hash).toBe(`#event/${id}`);
  await reply(pending(`/api/events/${id}`), { event: view({ counts: null }) });
  expect(visibleText()).toContain('Bring a dish');
  expect(visibleText()).toMatch(/Hosted by\s+Alice/);
  expect(button('Going')).toBeDefined();
});

it('opens an event link for a new member before showing its preview', async () => {
  location.hash = `#event/${token}`;
  await mount(
    createElement(MemberApp, {
      initialProfile: null,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const opened = pending('/api/events/open');
  expect(JSON.parse(String(opened.options?.body))).toEqual({ token });
  await reply(opened, { id });
  await reply(pending(`/api/events/${id}`), { event: view({ counts: null }) });
  expect(visibleText()).toContain('Enter your name to see details and RSVP.');
  expect(visibleText()).not.toContain('Bring a dish');
  expect(renderer.root.findByProps({ id: 'display-name' })).toBeDefined();
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

it.each(['feed', 'compose', 'profile/erin'])(
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
    expect(visibleText()).toContain('Set up your account');
    expect(visibleText()).toContain('Follow requests need your approval');
    expect(renderer.root.findAllByType(AvatarForm)).toHaveLength(0);
    const back = renderer.root.findByProps({
      className: 'button-link',
    });
    expect(back.props.href).toBe(`#event/${id}`);
    expect(requests.slice(before)).toEqual([]);
    expect(button('Continue').props.className).toBe('primary-button');
    await click('Continue');
    expect(button('Finish').props.disabled).toBe(true);
    expect(button('Choose profile photo')).toBeDefined();
    await selectSetupPhoto();
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
    expect(visibleText()).toContain('Set up your account');
    expect(button('Finishing…').props.disabled).toBe(true);
    await reply(pending('/api/avatar'), { ok: true });
    expect(
      requests.some((request) => request.path === '/api/people/erin'),
    ).toBe(false);
    await act(async () => window.dispatchEvent(new Event('hashchange')));
    expect(location.hash).toBe(
      destination.startsWith('profile/')
        ? '#profile/erin_photos'
        : `#${destination}`,
    );
    expect(
      renderer.root.findAllByProps({ className: 'nav-lock' }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType(AvatarForm)).toHaveLength(0);
    expect(visibleText()).not.toContain('Set up your account');
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
    className: 'button-link',
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
      preview: {
        title: 'Dinner',
        date: 'Friday',
        width: 4,
        height: 3,
        appearance: originalAppearance,
      },
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
  // CSS derives both the cover's shape and its wide-screen width from this.
  expect(button('Enlarge event photo').props.style).toEqual({
    '--event-photo-ratio': '4 / 3',
  });
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
  await reply(pending('/api/people/alice'), {
    profile: {
      handle: 'alice',
      displayName: 'Alice',
      bio: null,
      relationship: 'none',
    },
  });
  await click('Request to follow');
  expect(visibleText()).toContain('Set up your account');
  expect(
    renderer.root.findByProps({ className: 'button-link' }).props.href,
  ).toBe('#events');
  await click('Continue');
  await selectSetupPhoto();
  await type('handle', 'alice');
  await submit();
  await reply(
    pending('/api/people/self'),
    { error: 'That username is unavailable. Choose another.' },
    409,
  );
  expect(visibleText()).toContain('That username is unavailable');
  expect(renderer.root.findByProps({ id: 'handle' }).props.value).toBe('alice');
  expect(requests.some((request) => request.path === '/api/avatar')).toBe(
    false,
  );
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
  expect(location.hash).toBe('#profile/alice/join');
  await reply(pending('/api/avatar'), { ok: true });
  expect(location.hash).toBe('#profile/alice');
  await reply(pending('/api/people/alice'), {
    profile: {
      handle: 'alice',
      displayName: 'Alice',
      bio: null,
      relationship: 'none',
    },
  });
  expect(
    requests.some((request) => request.path === '/api/people/alice/request'),
  ).toBe(false);
  await click('Request to follow');
  expect(pending('/api/people/alice/request', 'POST')).toBeDefined();
});

async function selectSetupPhoto() {
  await act(async () =>
    renderer.root.findByType(AvatarForm).props.onSelect({
      id: crypto.randomUUID(),
      blob: new Blob(['synthetic crop'], { type: 'image/webp' }),
    }),
  );
}

it.each([false, true])(
  'offers calendar providers below the location and above the crowned hosts (complete profile: %s)',
  async (linkProfiles) => {
    await mount(createElement(EventPage, { id, linkProfiles }));
    await reply(pending(`/api/events/${id}`), {
      event: view({ counts: null }),
    });
    const info = renderer.root.findByProps({ className: 'event-information' });
    const children = info.children.filter(
      (child): child is ReactTestInstance => typeof child !== 'string',
    );
    const locationIndex = children.findIndex(
      (child) => child.props.className === 'event-detail-row event-location',
    );
    expect(children[locationIndex + 1]).toBe(button('Add to calendar'));
    expect(children[locationIndex + 2].type).toBe(EventHostRow);
    const hosts = children[locationIndex + 2].findByProps({
      className: 'event-hosts',
    });
    expect(hosts.findByType('svg').props['aria-hidden']).toBe('true');
    expect(hosts.children[0]).toBe(hosts.findByType('svg'));
    const before = requests.length;
    await click('Add to calendar');
    const providers = renderer.root
      .findByProps({ 'aria-label': 'Calendar provider' })
      .findAllByType('a');
    expect(providers.map(labelText)).toEqual([
      'Google Calendar',
      'Apple Calendar',
      'Outlook',
    ]);
    const google = new URL(providers[0].props.href);
    expect(google.pathname).toBe('/calendar/render');
    expect(google.searchParams.get('action')).toBe('TEMPLATE');
    expect(google.searchParams.get('text')).toBe('Dinner');
    expect(providers[1].props.href).toBe(`/api/events/${id}/calendar.ics`);
    expect(new URL(providers[2].props.href).searchParams.get('subject')).toBe(
      'Dinner',
    );
    for (const provider of providers) {
      expect(provider.props.target).toBe('_blank');
      expect(provider.props.rel).toBe('noopener noreferrer');
      expect(decodeURIComponent(provider.props.href)).not.toContain(token);
    }
    expect(requests.slice(before)).toEqual([]);
    await act(async () =>
      renderer.root
        .findByType('dialog')
        .props.onCancel({ preventDefault: vi.fn() }),
    );
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await click('Add to calendar');
    await click('Close add to calendar');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  },
);

it('keeps the calendar action above multiple hosts when there is no location', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: true }));
  await reply(pending(`/api/events/${id}`), {
    event: view({
      counts: null,
      location: '',
      endsAt: startsAt + 7200000,
      hosts: [
        ...details.hosts,
        { ...details.hosts[0], handle: 'bob', displayName: 'Bob' },
      ],
    }),
  });
  expect(visibleText()).toContain('Alice and Bob');
  expect(
    renderer.root.findAllByProps({ className: 'event-host-crown' }),
  ).toHaveLength(1);
  const info = renderer.root.findByProps({ className: 'event-information' });
  expect(info.children.indexOf(button('Add to calendar'))).toBeLessThan(
    info.children.indexOf(renderer.root.findByType(EventHostRow)),
  );
  await act(async () => renderer.unmount());
});

it('does not offer calendar export for cancelled or inaccessible events', async () => {
  await mount(createElement(EventPage, { id, linkProfiles: false }));
  await reply(pending(`/api/events/${id}`), {
    event: view({ cancelled: true, counts: null }),
  });
  expect(visibleText()).not.toContain('Add to calendar');
  await act(async () => renderer.unmount());
  await mount(createElement(EventPage, { id, linkProfiles: false }));
  await reply(pending(`/api/events/${id}`), { error: 'Event not found.' }, 404);
  expect(visibleText()).not.toContain('Add to calendar');
});

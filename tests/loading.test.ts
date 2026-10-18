import { act, createElement, type ReactElement } from 'react';
import {
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Welcome } from '../src/client/features/welcome/Welcome';
import { MemberApp } from '../src/client/features/people/MemberApp';
import { Discover } from '../src/client/features/people/Discover';
import { Connections } from '../src/client/features/people/Connections';
import { ProfilePage } from '../src/client/features/people/ProfilePage';
import {
  Compose,
  PostDetail,
  PostList,
} from '../src/client/features/posts/Posts';
import { Notifications } from '../src/client/features/notifications/Notifications';
import { InvitationForm } from '../src/client/features/invitations/InvitationForm';
import { Interactions } from '../src/client/features/interactions/Interactions';
import { AvatarForm } from '../src/client/features/avatars/AvatarForm';
import { PostCropEditor } from '../src/client/features/posts/PostCropEditor';
import { fullPhoto } from '../src/client/features/posts/crop';

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
  reject: (error: Error) => void;
};
let requests: Request[];
let renderer: ReactTestRenderer;
beforeEach(() => {
  authMocks.magicLink.mockReset();
  requests = [];
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', {
    hash: '#feed',
    search: '',
    origin: 'https://slowmass.com',
    reload: vi.fn(),
    replace: vi.fn(),
    assign: vi.fn((hash: string) => {
      location.hash = hash;
    }),
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
  // Deliberately allow aborted responses to arrive: the client must ignore them.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (path: string, options?: RequestInit) =>
        new Promise<Response>((resolve, reject) =>
          requests.push({ path, options, settled: false, resolve, reject }),
        ),
    ),
  );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
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
async function click(label: string) {
  const button = renderer.root
    .findAllByType('button')
    .find(
      (item) =>
        item.props['aria-label'] === label || item.children.join('') === label,
    );
  expect(button, `Button ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => {
    button!.props.onClick();
  });
}
async function confirmAction(label: string) {
  const button = renderer.root
    .findByType('dialog')
    .findAllByType('button')
    .find((item) => item.children.join('') === label);
  expect(button, `Confirmation ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => button!.props.onClick());
}

it('shows a unified unread badge, preserves it on failures, and pauses polling while hidden', async () => {
  vi.useFakeTimers();
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending('/api/notifications/unread-count'), { count: 3 });
  expect(
    renderer.root.findByProps({ className: 'nav-badge' }).children,
  ).toEqual(['3']);
  expect(
    renderer.root.findByProps({ 'aria-label': 'Activity' }).props[
      'aria-description'
    ],
  ).toContain('3 unread notifications');
  Object.assign(document, { visibilityState: 'hidden' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
  });
  expect(
    requests.filter((request) => request.path.includes('unread-count')),
  ).toHaveLength(1);
  Object.assign(document, { visibilityState: 'visible' });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await reply(pending('/api/notifications/unread-count'), {}, 503);
  expect(
    renderer.root.findByProps({ className: 'nav-badge' }).children,
  ).toEqual(['3']);
  await act(async () => window.dispatchEvent(new Event('focus')));
  const stale = pending('/api/notifications/unread-count');
  await act(async () => window.dispatchEvent(new Event('online')));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(stale.options?.signal?.aborted).toBe(false);
  expect(
    requests.filter((request) => request.path.includes('unread-count')),
  ).toHaveLength(3);
  await reply(stale, { count: 100 });
  expect(
    renderer.root.findByProps({ className: 'nav-badge' }).children,
  ).toEqual(['99+']);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await reply(pending('/api/notifications/unread-count'), { count: 0 });
  expect(renderer.root.findAllByProps({ className: 'nav-badge' })).toHaveLength(
    0,
  );
});

it('replaces an older badge read after a confirmed mutation and ignores its late result', async () => {
  location.hash = '#notifications';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const old = pending('/api/notifications/unread-count');
  await act(async () =>
    renderer.root.findByType(Notifications).props.onChange(),
  );
  const reads = requests.filter((request) =>
    request.path.includes('unread-count'),
  );
  expect(reads).toHaveLength(2);
  expect(old.options?.signal?.aborted).toBe(true);
  await reply(reads[1], { count: 1 });
  await reply(old, { count: 8 });
  expect(
    renderer.root.findByProps({ className: 'nav-badge' }).children,
  ).toEqual(['1']);
});

it('shows a new follower as a profile link without follow-request decisions', async () => {
  await mount(createElement(Notifications));
  await reply(pending('/api/notifications?'), {
    items: [
      {
        key: 'follower:bob',
        kind: 'follower',
        handle: 'bob',
        version: 1,
        unread: true,
        createdAt: 1,
      },
    ],
    next: null,
  });
  expect(visibleText().replace(/\s+/g, ' ')).toContain(
    '@ bob started following you.',
  );
  expect(renderer.root.findByType('a').props.href).toBe('#profile/bob');
  expect(renderer.root.findAllByType('button')).toHaveLength(0);
  expect(
    renderer.root.findByProps({ 'data-notification-key': 'follower:bob' }),
  ).toBeDefined();
});
it.each(['follow', 'dismiss'] as const)(
  'handles follow-back %s, retries failures, and refreshes eligibility',
  async (action) => {
    await mount(createElement(Notifications));
    const item = {
      key: 'follower:bob',
      kind: 'follower',
      handle: 'bob',
      version: 7,
      unread: true,
      createdAt: 1,
      canFollowBack: true,
    };
    await reply(pending('/api/notifications?'), { items: [item], next: null });
    const avatar = renderer.root.findByType('img');
    expect(renderer.root.findByType('img').props.src).toBe('/media/avatar/bob');
    const label =
      action === 'follow' ? 'Follow back' : 'Dismiss follow back for @bob';
    const path =
      action === 'follow'
        ? '/api/people/bob/request'
        : '/api/notifications/dismiss-follow-back';
    await click(label);
    expect(
      renderer.root
        .findAllByType('button')
        .every((button) => button.props.disabled),
    ).toBe(true);
    const request = pending(path);
    expect(request.options?.method).toBe('POST');
    if (action === 'dismiss')
      expect(JSON.parse(String(request.options?.body))).toEqual({
        key: item.key,
        version: item.version,
      });
    await reply(request, { error: 'Try again.' }, 503);
    expect(visibleText()).toContain('Try again.');
    await click(label);
    await reply(pending(path), { ok: true });
    expect(renderer.root.findByType('img')).toBe(avatar);
    expect(visibleText()).not.toContain('Loading notifications');
    await reply(pending('/api/notifications?'), {
      items: [{ ...item, canFollowBack: false }],
      next: null,
    });
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findByType('img')).toBe(avatar);
    expect(visibleText()).toContain('started following you.');
  },
);
it('batches visible notification receipts, retries failure, and keeps seen requests actionable', async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  let intersection: IntersectionObserverCallback;
  const takeRecords = vi.fn(() => []);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = takeRecords;
    },
  );
  const elements = ['request:bob', 'likes:one', 'comment:two'].map((key) => ({
    getAttribute: () => key,
  }));
  await act(async () => {
    renderer = create(createElement(Notifications, { onChange }), {
      createNodeMock: (node) =>
        node.type === 'ul' ? { querySelectorAll: () => elements } : null,
    });
  });
  await reply(pending('/api/notifications?'), {
    items: [
      {
        key: 'request:bob',
        kind: 'request',
        handle: 'bob',
        version: 1,
        unread: true,
        createdAt: 1,
      },
      {
        key: 'likes:one',
        kind: 'likes',
        postId: 'one',
        count: 2,
        version: 2,
        unread: true,
        createdAt: 2,
      },
      {
        key: 'comment:two',
        kind: 'comment',
        postId: 'two',
        handle: 'bob',
        body: 'Hi',
        version: 3,
        unread: true,
        createdAt: 3,
      },
    ],
    next: null,
  });
  expect(requests).toHaveLength(1);
  await act(async () =>
    intersection(
      elements.slice(0, 2).map((target) => ({
        target,
        isIntersecting: true,
        intersectionRatio: 1,
      })) as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  await act(async () => vi.advanceTimersByTime(249));
  expect(requests).toHaveLength(1);
  await act(async () => vi.advanceTimersByTime(2));
  const receipt = pending('/api/notifications/read');
  const expected = {
    items: [
      { key: 'request:bob', version: 1 },
      { key: 'likes:one', version: 2 },
    ],
  };
  expect(JSON.parse(receipt.options!.body as string)).toEqual(expected);
  await reply(receipt, {}, 503);
  expect(onChange).not.toHaveBeenCalled();
  expect(visibleText()).toContain('Could not save read status. Retrying…');
  await act(async () => vi.advanceTimersByTime(1000));
  const retry = pending('/api/notifications/read');
  expect(JSON.parse(retry.options!.body as string)).toEqual(expected);
  await reply(retry, { ok: true });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(visibleText()).not.toContain('Could not save read status');
  expect(visibleText()).toContain('requested to follow you.');
  await click('Accept');
  await reply(pending('/api/people/bob/accept'), { ok: true });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(visibleText()).not.toContain('Loading notifications…');
  expect(visibleText()).not.toContain('requested to follow you.');
  expect(renderer.root.findAllByType('img')).toHaveLength(2);
});
function noLogin() {
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
  expect(visibleText()).not.toContain('Welcome to slowmass');
}

it('keeps the profile photo mounted through follow request and cancellation without restarting posts', async () => {
  await mount(createElement(ProfilePage, { handle: 'alice' }));
  const profile = { ...ownProfile, bio: null, relationship: 'none' };
  await reply(pending('/api/people/alice'), { profile });
  const avatar = renderer.root.findByProps({ src: '/media/avatar/alice' });
  for (const [label, action, relationship] of [
    ['Request to follow', 'request', 'pending'],
    ['Cancel request', 'cancel', 'none'],
  ]) {
    await click(label);
    await reply(pending(`/api/people/alice/${action}`), { ok: true });
    expect(renderer.root.findByProps({ src: '/media/avatar/alice' })).toBe(
      avatar,
    );
    expect(visibleText()).not.toContain('Loading profile');
    expect(
      renderer.root.findByProps({ 'aria-label': label }).props.disabled,
    ).toBe(true);
    await reply(pending('/api/people/alice'), {
      profile: { ...profile, relationship },
    });
    expect(renderer.root.findByProps({ src: '/media/avatar/alice' })).toBe(
      avatar,
    );
    expect(
      renderer.root.findAllByProps({ className: 'post-grid' }),
    ).toHaveLength(0);
  }
  expect(
    requests.filter((request) => request.path.startsWith('/api/posts?')),
  ).toHaveLength(1);
  expect(location.reload).not.toHaveBeenCalled();
});

it('clears a retained profile after denied revalidation and ignores late refreshes after navigation', async () => {
  await mount(createElement(ProfilePage, { handle: 'alice' }));
  const profile = { ...ownProfile, bio: null, relationship: 'none' };
  await reply(pending('/api/people/alice'), { profile });
  await click('Request to follow');
  await reply(pending('/api/people/alice/request'), { ok: true });
  await reply(
    pending('/api/people/alice'),
    { error: 'Profile unavailable' },
    403,
  );
  expect(renderer.root.findAllByType('img')).toHaveLength(0);
  expect(visibleText()).toContain('Profile unavailable');
  await click('Retry');
  await reply(pending('/api/people/alice'), { profile });
  await click('Request to follow');
  await reply(pending('/api/people/alice/request'), { ok: true });
  const late = pending('/api/people/alice');
  await act(async () =>
    renderer.update(createElement(ProfilePage, { handle: 'bob' })),
  );
  expect(late.options?.signal?.aborted).toBe(true);
  expect(renderer.root.findAllByType('img')).toHaveLength(0);
  await reply(pending('/api/people/bob'), {
    profile: { ...profile, handle: 'bob' },
  });
  await reply(late, { profile: { ...profile, relationship: 'accepted' } });
  expect(renderer.root.findByType('img').props.src).toBe('/media/avatar/bob');
  expect(renderer.root.findAllByProps({ className: 'post-grid' })).toHaveLength(
    0,
  );
});

it('deletes only the chosen feed card while preserving other photos, open comments, and drafts through refreshed counts', async () => {
  await mount(createElement(PostList));
  const target = { ...post('target'), isOwner: true };
  const survivor = post('survivor');
  await reply(pending('/api/posts?'), {
    items: [target, survivor],
    next: null,
  });
  const photo = renderer.root.findByProps({ src: survivor.mediaUrl });
  const card = renderer.root.findAllByType('article')[1];
  await act(async () =>
    card.findByProps({ 'aria-label': 'Show comments' }).props.onClick(),
  );
  await reply(pending('/api/interactions/survivor/comments?'), {
    items: [],
    next: null,
  });
  const field = card.findByType('textarea');
  await act(async () =>
    field.props.onChange({ target: { value: 'Keep my draft' } }),
  );
  await click('Post options');
  await click('Delete post');
  await act(async () =>
    renderer.root
      .findByType('dialog')
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
  await reply(pending('/api/posts/target'), { ok: true });
  expect(renderer.root.findAllByType('article')).toEqual([card]);
  expect(renderer.root.findByProps({ src: survivor.mediaUrl })).toBe(photo);
  expect(field.props.value).toBe('Keep my draft');
  await reply(pending('/api/posts?'), {
    items: [{ ...survivor, likeCount: 3, liked: 1, commentCount: 2 }],
    next: null,
  });
  expect(renderer.root.findByProps({ src: survivor.mediaUrl })).toBe(photo);
  expect(renderer.root.findByType('textarea')).toBe(field);
  expect(field.props.value).toBe('Keep my draft');
  expect(
    renderer.root.findByProps({ 'aria-label': 'Unlike photo' }),
  ).toBeDefined();
  expect(
    requests.filter((request) =>
      request.path.startsWith('/api/interactions/survivor/comments?'),
    ),
  ).toHaveLength(1);
});
const ownProfile = {
  handle: 'alice',
  displayName: 'Alice',
  bio: 'Hello',
  hasAvatar: 1,
};
function post(id: string) {
  return {
    id,
    handle: 'alice',
    displayName: 'Alice',
    caption: `Photo ${id}`,
    altText: '',
    width: 100,
    height: 100,
    publishedAt: 1,
    isOwner: false,
    mediaUrl: `/media/post/${id}`,
    thumbnailUrl: `/media/post/${id}?size=grid`,
    likeCount: 0,
    commentCount: 0,
    liked: 0,
  };
}

const signedIn = {
  signInAvailable: true,
  user: { id: 'alice', name: 'Alice' },
  profile: ownProfile,
};

const invitationPreview = {
  status: 'ready',
  email: 'invited@example.com',
  expiresAt: Date.now() + 7 * 86400000,
  inviter: { name: 'Alice Example', handle: 'alice' },
  signedInAs: null,
};
async function mountInvitation() {
  location.pathname = '/join';
  location.hash = '#' + 'a'.repeat(48);
  await mount(createElement(Welcome));
}

it('checks an invitation without showing login or consuming it, then accepts only on click', async () => {
  await mountInvitation();
  expect(visibleText()).toContain('Checking your invitation…');
  expect(requests.map((r) => r.path)).toEqual(['/api/auth/invitation/preview']);
  noLogin();
  await reply(pending('/api/auth/invitation/preview'), invitationPreview);
  expect(visibleText()).toContain('Alice Example');
  expect(visibleText()).toContain('invited you.');
  expect(visibleText()).toContain('invited@example.com');
  expect(renderer.root.findAllByType('input')).toHaveLength(0);
  expect(requests).toHaveLength(1);
  await click('Accept invitation');
  expect(visibleText()).toContain('Joining…');
  expect(renderer.root.findAllByType('button')[0].props.disabled).toBe(true);
  const request = pending('/api/auth/invitation/accept');
  expect(JSON.parse(request.options!.body as string)).toEqual({
    token: 'a'.repeat(48),
  });
  await reply(request, { ok: true });
  expect(location.replace).toHaveBeenCalledWith('/');
});

it('retries a failed invitation lookup without falling back to the login form', async () => {
  await mountInvitation();
  await reply(pending('/api/auth/invitation/preview'), {}, 503);
  expect(visibleText()).toContain('couldn’t check this invitation');
  noLogin();
  await click('Try again');
  expect(visibleText()).toContain('Checking your invitation…');
  await reply(pending('/api/auth/invitation/preview'), invitationPreview);
  expect(visibleText()).toContain('Accept invitation');
});

it('requires explicit account switching before accepting an invitation for another email', async () => {
  await mountInvitation();
  await reply(pending('/api/auth/invitation/preview'), {
    ...invitationPreview,
    signedInAs: 'bob@example.com',
  });
  expect(visibleText()).toContain('bob@example.com');
  expect(visibleText()).not.toContain('Accept invitation');
  expect(requests).toHaveLength(1);
  await click('Sign out to continue');
  await reply(pending('/api/auth/sign-out'), { success: true });
  await reply(pending('/api/auth/invitation/preview'), invitationPreview);
  expect(visibleText()).toContain('Accept invitation');
});

it('rechecks invitation status when it was cancelled or used between preview and acceptance', async () => {
  await mountInvitation();
  await reply(pending('/api/auth/invitation/preview'), invitationPreview);
  await click('Accept invitation');
  await reply(
    pending('/api/auth/invitation/accept'),
    { code: 'INVITATION_UNAVAILABLE' },
    400,
  );
  await reply(pending('/api/auth/invitation/preview'), { status: 'cancelled' });
  expect(visibleText()).toContain('no longer active');
  expect(visibleText()).not.toContain('Accept invitation');
  expect(location.replace).not.toHaveBeenCalled();
});

it.each([
  ['used', 'can’t be used again'],
  ['expired', 'has expired'],
  ['invalid', 'incomplete or invalid'],
])(
  'explains an %s invitation and offers the normal sign-in path',
  async (status, message) => {
    await mountInvitation();
    await reply(pending('/api/auth/invitation/preview'), { status });
    expect(visibleText()).toContain(message);
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(renderer.root.findAllByType('a').at(-1)!.props.href).toBe('/');
  },
);

it('leaves a failed acceptance retryable and gives a sign-in recovery path', async () => {
  await mountInvitation();
  await reply(pending('/api/auth/invitation/preview'), invitationPreview);
  await click('Accept invitation');
  const request = pending('/api/auth/invitation/accept');
  request.settled = true;
  await act(async () => request.reject(new Error('Connection lost')));
  expect(visibleText()).toContain('couldn’t confirm joining');
  expect(location.replace).not.toHaveBeenCalled();
  await click('Accept invitation');
  await reply(
    pending('/api/auth/invitation/accept'),
    { code: 'INVITATION_UNAVAILABLE' },
    400,
  );
  await reply(pending('/api/auth/invitation/preview'), { status: 'used' });
  expect(visibleText()).toContain('Already joined');
});

it('loads the feed after one bootstrap request without login, onboarding, or redundant account reads', async () => {
  await mount(createElement(Welcome));
  expect(visibleText()).toContain('Loading slowmass…');
  noLogin();
  expect(requests.map((request) => request.path)).toEqual(['/api/bootstrap']);
  await reply(pending('/api/bootstrap'), signedIn);
  expect(visibleText()).toContain('Loading posts…');
  expect(visibleText()).not.toContain('Create your profile');
  expect(requests.map((request) => request.path)).toEqual([
    '/api/bootstrap',
    '/api/posts?',
    '/api/notifications/unread-count?includeJoined=1',
  ]);
  await reply(pending('/api/posts?'), { items: [], next: null });
  expect(visibleText()).toContain('No posts on this page.');
  noLogin();
});

it('shows login only after bootstrap confirms a signed-out session', async () => {
  await mount(createElement(Welcome));
  noLogin();
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  expect(visibleText()).toContain('Send sign-in link');
  expect(visibleText()).not.toContain('Loading slowmass');
});

it('keeps uninvited addresses on the welcome form and allows a successful retry', async () => {
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: true,
    user: null,
    profile: null,
  });
  await act(async () => {
    renderer.root.findByProps({ id: 'email' }).props.onChange({
      target: { value: 'Uninvited@Example.com' },
    });
  });
  authMocks.magicLink.mockResolvedValueOnce({
    error: { code: 'INVITATION_REQUIRED', status: 403 },
  });
  await act(async () => {
    await renderer.root.findByType('form').props.onSubmit({
      preventDefault: vi.fn(),
    });
  });
  expect(visibleText()).toContain(
    'You need an invitation from a slowmass member',
  );
  expect(visibleText()).not.toContain('Check your email');
  expect(renderer.root.findByProps({ id: 'email' }).props.value).toBe(
    'Uninvited@Example.com',
  );
  expect(authMocks.magicLink).toHaveBeenLastCalledWith({
    email: 'uninvited@example.com',
    callbackURL: '/',
    errorCallbackURL: '/?error=signin',
  });
  // Once invited, the same address can retry without reloading the page.
  authMocks.magicLink.mockResolvedValueOnce({
    data: { status: true },
    error: null,
  });
  await act(async () => {
    await renderer.root.findByType('form').props.onSubmit({
      preventDefault: vi.fn(),
    });
  });
  expect(visibleText()).toContain('Check your email');
  expect(visibleText()).toContain('uninvited@example.com');
  expect(visibleText()).not.toContain('You need an invitation');
});

it.each([403, 429, 500])(
  'does not describe other sign-in errors (%s) as missing invitations',
  async (status) => {
    await mount(createElement(Welcome));
    await reply(pending('/api/bootstrap'), {
      signInAvailable: true,
      user: null,
      profile: null,
    });
    authMocks.magicLink.mockResolvedValueOnce({
      error: { code: 'OTHER_ERROR', status },
    });
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({
        preventDefault: vi.fn(),
      });
    });
    expect(visibleText()).toContain('Wait a minute and try again');
    expect(visibleText()).not.toContain('You need an invitation');
    expect(visibleText()).not.toContain('Check your email');
  },
);

it('does not mistake bootstrap failures for signed-out state or incomplete onboarding', async () => {
  vi.useFakeTimers();
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), { error: 'Unavailable' }, 503);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await reply(pending('/api/bootstrap'), { error: 'Unavailable' }, 503);
  noLogin();
  expect(visibleText()).toContain('We couldn’t load slowmass.');
  await click('Try again');
  expect(visibleText()).toContain('Loading slowmass…');
  expect(visibleText()).not.toContain('We couldn’t load slowmass.');
  await reply(pending('/api/bootstrap'), signedIn);
  noLogin();
  expect(visibleText()).toContain('Loading posts…');
});

it('times out stalled bootstrap, ignores late data, and retries without signing out', async () => {
  vi.useFakeTimers();
  await mount(createElement(Welcome));
  const first = pending('/api/bootstrap');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(19_999);
  });
  expect(visibleText()).toContain('Loading slowmass…');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(first.options?.signal?.aborted).toBe(true);
  noLogin();
  expect(visibleText()).toContain('We couldn’t load slowmass.');
  const second = requests.filter((item) => item.path === '/api/bootstrap')[1];
  second.settled = true;
  await click('Try again');
  await reply(first, { signInAvailable: true, user: null, profile: null });
  noLogin();
  expect(visibleText()).toContain('Loading slowmass…');
  await reply(pending('/api/bootstrap'), signedIn);
  await reply(pending('/api/posts?'), { items: [], next: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(visibleText()).toContain('No posts on this page.');
  expect(visibleText()).not.toContain('We couldn’t load slowmass.');
  noLogin();
});

it('clears the startup deadline and aborts the request on unmount', async () => {
  vi.useFakeTimers();
  await mount(createElement(Welcome));
  const request = pending('/api/bootstrap');
  await act(async () => renderer.unmount());
  expect(request.options?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds page reads and ignores a late result after retry without signing out', async () => {
  vi.useFakeTimers();
  await mount(createElement(PostList));
  const first = pending('/api/posts?');
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(first.options?.signal?.aborted).toBe(true);
  expect(visibleText()).toContain('This page took too long to load.');
  await click('Retry');
  await reply(first, { items: [post('late')], next: null });
  expect(visibleText()).toContain('Loading posts…');
  await reply(pending('/api/posts?'), { items: [], next: null });
  expect(visibleText()).toContain('No posts on this page.');
  noLogin();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps unavailable and offline startup separate from login', async () => {
  vi.useFakeTimers();
  await mount(createElement(Welcome));
  const first = pending('/api/bootstrap');
  first.settled = true;
  await act(async () => {
    first.reject(new TypeError('Failed to fetch'));
  });
  noLogin();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await reply(pending('/api/bootstrap'), {
    signInAvailable: false,
    user: null,
    profile: null,
  });
  expect(visibleText()).toContain('temporarily unavailable');
  noLogin();
  expect(
    requests.filter((item) => item.path === '/api/bootstrap'),
  ).toHaveLength(2);
  expect(pending('/api/startup-diagnostics').options?.credentials).toBe('omit');
});

it('opens onboarding only when bootstrap has confirmed the missing profile', async () => {
  await mount(createElement(Welcome));
  expect(visibleText()).not.toContain('Create your profile');
  await reply(pending('/api/bootstrap'), { ...signedIn, profile: null });
  expect(visibleText()).toContain('Create your profile');
});

it.each([null, { ...ownProfile, hasAvatar: 0 }])(
  'restores onboarding from bootstrap even when returning to a main-app deep link (%j)',
  async (profile) => {
    location.hash = '#post/saved-post';
    await mount(createElement(Welcome));
    await reply(pending('/api/bootstrap'), { ...signedIn, profile });
    expect(visibleText()).toContain(
      profile ? 'Add a profile photo' : 'Create your profile',
    );
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
    ).toHaveLength(0);
    expect(requests.map((request) => request.path)).toEqual(['/api/bootstrap']);
    expect(visibleText()).not.toContain('follow each other automatically');
  },
);

it('prioritizes the first feed photo and uses smaller files for profile grids', async () => {
  const items = ['one', 'two', 'three', 'four'].map(post);
  await mount(createElement(PostList));
  await reply(pending('/api/posts?'), { items, next: null });
  const images = renderer.root
    .findAllByType('img')
    .filter((image) => image.props.src.startsWith('/media/post/'));
  expect(images.map((image) => image.props.loading)).toEqual([
    'eager',
    'lazy',
    'lazy',
    'lazy',
  ]);
  expect(images.map((image) => image.props.fetchPriority)).toEqual([
    'high',
    'auto',
    'auto',
    'auto',
  ]);
  await act(async () => renderer.unmount());
  await mount(createElement(PostList, { handle: 'alice', grid: true }));
  await reply(pending('/api/posts?handle=alice'), { items, next: null });
  const thumbs = renderer.root.findAllByType('img');
  expect(thumbs.map((image) => image.props.src)).toEqual(
    items.map((item) => item.thumbnailUrl),
  );
  expect(thumbs.map((image) => image.props.loading)).toEqual([
    'eager',
    'eager',
    'eager',
    'lazy',
  ]);
});

it.each([false, true])(
  'requires a saved photo before opening the app (resuming onboarding: %s)',
  async (existing) => {
    const onSignOut = vi.fn();
    await mount(
      createElement(MemberApp, {
        initialProfile: existing ? { ...ownProfile, hasAvatar: 0 } : null,
        onSignOut,
        signingOut: false,
      }),
    );
    if (!existing) {
      expect(visibleText()).toContain('Continue');
      await act(async () => {
        renderer.root
          .findByProps({ id: 'handle' })
          .props.onChange({ target: { value: 'alice' } });
        renderer.root
          .findByProps({ id: 'display-name' })
          .props.onChange({ target: { value: 'Alice' } });
      });
      await act(async () =>
        renderer.root
          .findByType('form')
          .props.onSubmit({ preventDefault: vi.fn() }),
      );
      await reply(pending('/api/people/self'), {
        profile: { ...ownProfile, hasAvatar: 0 },
      });
      await go(location.hash);
    }
    expect(renderer.root.findByType('h1').children).toEqual([
      'Add a profile photo',
    ]);
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
    ).toHaveLength(0);
    expect(requests.every((item) => item.path === '/api/people/self')).toBe(
      true,
    );
    expect(renderer.root.findByType(AvatarForm).props.onboarding).toBe(true);
    expect(visibleText()).not.toContain('Delete account');
    await click('Use a different account');
    expect(onSignOut).toHaveBeenCalledOnce();
    await act(async () =>
      renderer.root.findByType(AvatarForm).props.onChange(),
    );
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
    ).toHaveLength(1);
    expect(
      pending(existing ? '/api/posts?' : '/api/people/alice'),
    ).toBeDefined();
    expect(visibleText()).not.toContain('Add a profile photo');
  },
);

const lists = [
  {
    name: 'posts',
    element: () => createElement(PostList),
    path: '/api/posts?',
    loading: 'Loading posts…',
    empty: 'No posts on this page.',
    retry: 'Retry',
  },
  {
    name: 'people',
    element: () => createElement(Discover),
    path: '/api/people/discover?',
    loading: 'Finding people…',
    empty: 'No people found.',
    retry: 'Retry',
  },
  {
    name: 'connections',
    element: () => createElement(Connections, { kind: 'followers' }),
    path: '/api/people/connections?',
    loading: 'Loading…',
    empty: 'No accounts on this page.',
    retry: 'Retry',
  },
  {
    name: 'activity',
    element: () => createElement(Notifications),
    path: '/api/notifications?',
    loading: 'Loading notifications…',
    empty: 'No activity on this page.',
    retry: 'Retry',
  },
  {
    name: 'invitations',
    element: () => createElement(InvitationForm),
    path: '/api/invitations?',
    loading: 'Loading invitations…',
    empty: 'No invitations yet.',
    retry: 'Retry',
  },
];
it.each(lists)(
  '$name distinguish loading, failure, retry, and a confirmed empty page',
  async ({ element, path, loading, empty, retry }) => {
    await mount(element());
    expect(visibleText()).toContain(loading);
    expect(visibleText()).not.toContain(empty);
    await reply(pending(path), { error: 'Read failed' }, 503);
    expect(visibleText()).not.toContain(loading);
    expect(visibleText()).not.toContain(empty);
    await click(retry);
    expect(visibleText()).toContain(loading);
    expect(visibleText()).not.toContain('Read failed');
    await reply(pending(path), { items: [], next: null });
    expect(visibleText()).toContain(empty);
    expect(visibleText()).not.toContain(loading);
  },
);

it.each([
  {
    panel: 'comments',
    open: 'Show comments',
    retry: 'Retry',
    empty: 'No comments on this page.',
  },
  {
    panel: 'likes',
    open: 'See 1 likes',
    retry: 'Retry',
    empty: 'No likes to show.',
  },
])(
  '$panel retry without retaining old errors or premature empty messages',
  async ({ panel, open, retry, empty }) => {
    await mount(
      createElement(Interactions, {
        postId: 'one',
        initial: { likeCount: 1, commentCount: 0, liked: 0 },
      }),
    );
    await click(open);
    expect(visibleText()).toContain(`Loading ${panel}…`);
    expect(visibleText()).not.toContain(empty);
    await reply(
      pending(`/api/interactions/one/${panel}?`),
      { error: 'Read failed' },
      503,
    );
    await click(retry);
    expect(visibleText()).toContain(`Loading ${panel}…`);
    expect(visibleText()).not.toContain('Read failed');
    await reply(pending(`/api/interactions/one/${panel}?`), {
      items: [],
      next: null,
    });
    expect(visibleText()).toContain(empty);
  },
);

it.each(['self', 'none'])(
  'enlarges a profile photo on demand, supports retry, and discards it on navigation (%s)',
  async (relationship) => {
    await mount(createElement(ProfilePage, { handle: 'alice' }));
    await reply(pending('/api/people/alice'), {
      profile: { ...ownProfile, relationship, bio: null },
    });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'avatar' }).props.src).toBe(
      '/media/avatar/alice',
    );
    await click("Enlarge @alice's profile photo");
    let dialog = renderer.root.findByType('dialog');
    let image = dialog.findByType('img');
    expect(image.props.src).toBe('/media/avatar/alice?size=large');
    expect(dialog.props.className).toContain('app-dialog-image');
    expect(dialog.findByType('h2').props.className).toBe('visually-hidden');
    expect(image.props.alt).toBe("@alice's profile photo");
    expect(visibleText()).toContain('Loading profile photo…');
    expect(image.props.style.visibility).toBe('hidden');
    await act(async () => image.props.onError());
    expect(visibleText()).toContain('Could not load this profile photo.');
    await click('Retry');
    expect(visibleText()).not.toContain('Could not load this profile photo.');
    expect(visibleText()).toContain('Loading profile photo…');
    image = dialog.findByType('img');
    await act(async () => image.props.onLoad());
    expect(image.props.style.visibility).toBe('visible');
    expect(visibleText()).not.toContain('Loading profile photo…');
    await click('Close profile photo');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await click("Enlarge @alice's profile photo");
    dialog = renderer.root.findByType('dialog');
    expect(dialog.findByType('img').props.style.visibility).toBe('hidden');
    await act(async () => {
      renderer.update(createElement(ProfilePage, { handle: 'bob' }));
    });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await reply(pending('/api/people/bob'), {
      profile: {
        handle: 'bob',
        displayName: 'Bob',
        relationship: 'none',
        bio: null,
      },
    });
    await click("Enlarge @bob's profile photo");
    expect(renderer.root.findByType('dialog').findByType('img').props.src).toBe(
      '/media/avatar/bob?size=large',
    );
  },
);

it('opens the focused photo itself only on wider screens and closes it when resized or navigated away', async () => {
  let onChange: (() => void) | undefined;
  const media = {
    matches: false,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      onChange = listener;
    }),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
  await mount(createElement(PostDetail, { id: 'large' }));
  const large = {
    ...post('large'),
    width: 1600,
    height: 1000,
    altText: 'A mountain',
  };
  await reply(pending('/api/posts/large'), { post: large });
  expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 900px)');
  const triggers = () =>
    renderer.root.findAllByProps({ 'aria-label': 'Enlarge post photo' });
  expect(triggers()).toHaveLength(0);
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findByProps({ className: 'post-photo' }).props.src).toBe(
    large.mediaUrl,
  );
  await act(async () => {
    media.matches = true;
    onChange!();
  });
  const trigger = triggers()[0];
  expect(trigger.children).toHaveLength(1);
  expect(trigger.findByType('img').props.alt).toBe('A mountain');
  expect(trigger.props['aria-haspopup']).toBe('dialog');
  await click('Enlarge post photo');
  const dialog = renderer.root.findByType('dialog');
  expect(dialog.props.className).toContain('app-dialog-image');
  let image = dialog.findByType('img');
  expect(image.props).toMatchObject({
    src: large.mediaUrl,
    alt: 'A mountain',
    width: 1600,
    height: 1000,
  });
  expect(visibleText()).toContain('Loading post photo…');
  await act(async () => image.props.onError());
  expect(visibleText()).toContain('Could not load this post photo.');
  await click('Retry');
  image = dialog.findByType('img');
  await act(async () => image.props.onLoad());
  expect(image.props.style.visibility).toBe('visible');
  await act(async () => dialog.props.onCancel({ preventDefault: vi.fn() }));
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await click('Enlarge post photo');
  await act(async () => {
    media.matches = false;
    onChange!();
  });
  expect(triggers()).toHaveLength(0);
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await act(async () => {
    media.matches = true;
    onChange!();
  });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await click('Enlarge post photo');
  await click('Close post photo');
  await click('Enlarge post photo');
  await act(async () =>
    renderer.update(createElement(PostDetail, { id: 'other' })),
  );
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(media.removeEventListener).toHaveBeenCalledWith('change', onChange);
});

it('keeps feed photos linked to their focused page on wider screens', async () => {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  await mount(createElement(PostList));
  await reply(pending('/api/posts?'), { items: [post('feed')], next: null });
  const link = renderer.root.findByProps({ className: 'post-photo-link' });
  expect(link.props.href).toBe('#post/feed');
  expect(link.findByType('img').props.src).toBe(post('feed').mediaUrl);
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Enlarge post photo' }),
  ).toHaveLength(0);
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
});

it('clears previous photo details during navigation and ignores a late, aborted response', async () => {
  await mount(createElement(PostDetail, { id: 'old' }));
  const old = pending('/api/posts/old');
  await act(async () => {
    renderer.update(createElement(PostDetail, { id: 'new' }));
  });
  expect(old.options?.signal?.aborted).toBe(true);
  await reply(pending('/api/posts/new'), { post: post('new') });
  await reply(old, { post: post('old') });
  expect(visibleText()).toContain('Photo new');
  expect(visibleText()).not.toContain('Photo old');
  await act(async () => {
    renderer.update(createElement(PostDetail, { id: 'old' }));
  });
  expect(visibleText()).toContain('Loading photo…');
  expect(visibleText()).not.toContain('Photo new');
  await act(async () => {
    renderer.update(createElement(PostDetail, { id: 'new' }));
  });
  expect(visibleText()).toContain('Loading photo…');
  expect(visibleText()).not.toContain('Photo new');
  await reply(pending('/api/posts/new'), { error: 'Photo unavailable' }, 503);
  await click('Retry');
  expect(visibleText()).toContain('Loading photo…');
  expect(visibleText()).not.toContain('Photo unavailable');
});

it('does not show an old feed page or end marker while paging', async () => {
  await mount(createElement(PostList));
  await reply(pending('/api/posts?'), {
    items: [post('first')],
    next: 'older',
  });
  await click('Older');
  expect(visibleText()).toContain('Loading posts…');
  expect(visibleText()).not.toContain('Photo first');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'End of posts' }),
  ).toHaveLength(0);
  await reply(pending('/api/posts?cursor=older'), { items: [], next: null });
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'End of posts' }),
  ).toHaveLength(1);
  expect(visibleText()).not.toContain('End of posts');
});

it('waits for profile authorization before showing private or empty states', async () => {
  await mount(createElement(ProfilePage, { handle: 'alice' }));
  expect(visibleText()).toContain('Loading profile…');
  expect(visibleText()).not.toContain('This account is private');
  await reply(pending('/api/people/alice'), { error: 'Read failed' }, 503);
  await click('Retry');
  expect(visibleText()).toContain('Loading profile…');
  expect(visibleText()).not.toContain('Read failed');
  await reply(pending('/api/people/alice'), {
    profile: { ...ownProfile, bio: null, relationship: 'pending' },
  });
  expect(visibleText()).toContain('This account is private');
  const reads = requests.filter((item) => item.path.startsWith('/api/posts'));
  expect(reads).toHaveLength(2);
  expect(reads.every((item) => item.options?.signal?.aborted)).toBe(true);
  expect(renderer.root.findAllByProps({ className: 'post-grid' })).toHaveLength(
    0,
  );
});

it.each(['connections', 'activity'])(
  '%s stop showing resolved relationship actions while refreshing',
  async (kind) => {
    await mount(
      kind === 'connections'
        ? createElement(Connections, { kind: 'followers' })
        : createElement(Notifications),
    );
    const path =
      kind === 'connections'
        ? '/api/people/connections?'
        : '/api/notifications?';
    await reply(pending(path), {
      items: [
        {
          key: 'request:alice',
          kind: 'request',
          handle: 'alice',
          displayName: 'Alice',
          createdAt: 1,
        },
        {
          key: 'joined:bob',
          kind: 'joined',
          handle: 'bob',
          displayName: 'Bob',
          createdAt: 1,
        },
      ],
      next: null,
    });
    const action = kind === 'connections' ? 'remove' : 'accept';
    const remainingAvatar = renderer.root.findByProps({
      src: '/media/avatar/bob',
    });
    if (kind === 'connections') {
      await click('Remove @alice as a follower');
      expect(
        requests.some((request) => request.options?.method === 'POST'),
      ).toBe(false);
    }
    await click(kind === 'connections' ? 'Remove follower' : 'Accept');
    await reply(pending(`/api/people/alice/${action}`), { ok: true });
    expect(visibleText()).not.toContain('Loading');
    expect(renderer.root.findByProps({ src: '/media/avatar/bob' })).toBe(
      remainingAvatar,
    );
    expect(visibleText()).not.toContain('@alice');
    expect(
      renderer.root
        .findAllByType('button')
        .some((item) => item.children.join('') === 'Accept'),
    ).toBe(false);
    await reply(pending(path), {
      items: [
        {
          key: 'joined:bob',
          kind: 'joined',
          handle: 'bob',
          displayName: 'Bob',
          createdAt: 1,
        },
      ],
      next: null,
    });
    expect(renderer.root.findByProps({ src: '/media/avatar/bob' })).toBe(
      remainingAvatar,
    );
  },
);

it.each(['followers', 'following'] as const)(
  'shows avatars and requires confirmation before changing %s, with failure recovery',
  async (kind) => {
    await mount(createElement(Connections, { kind }));
    await reply(pending('/api/people/connections?'), {
      items: [{ handle: 'bob', displayName: 'Bob' }],
      next: null,
    });
    expect(renderer.root.findByType('img').props.src).toBe('/media/avatar/bob');
    expect(renderer.root.findByProps({ href: '#profile/bob' })).toBeDefined();
    const label =
      kind === 'followers' ? 'Remove @bob as a follower' : 'Unfollow @bob';
    const confirm = kind === 'followers' ? 'Remove follower' : 'Unfollow';
    const path = `/api/people/bob/${kind === 'followers' ? 'remove' : 'unfollow'}`;
    await click(label);
    expect(requests.some((item) => item.options?.method === 'POST')).toBe(
      false,
    );
    await click('Cancel');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(requests.some((item) => item.options?.method === 'POST')).toBe(
      false,
    );
    await click(label);
    await click(confirm);
    expect(renderer.root.findByType('dialog').props['aria-busy']).toBe(true);
    await reply(pending(path), { error: 'Please retry' }, 503);
    expect(
      renderer.root.findByType('dialog').findByProps({ role: 'alert' })
        .children,
    ).toEqual(['Please retry']);
    await click(confirm);
    await reply(pending(path), { ok: true });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await reply(pending('/api/people/connections?'), { items: [], next: null });
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
  },
);

it.each(['unfollow', 'block'] as const)(
  'requires profile %s confirmation and keeps failures open for retry',
  async (action) => {
    await mount(createElement(ProfilePage, { handle: 'bob' }));
    await reply(pending('/api/people/bob'), {
      profile: {
        handle: 'bob',
        displayName: 'Bob',
        bio: '',
        relationship: 'accepted',
      },
    });
    await reply(pending('/api/posts?handle=bob'), { items: [], next: null });
    const label = action === 'block' ? 'Block account' : 'Unfollow';
    async function open() {
      expect(
        renderer.root.findAllByProps({ className: 'profile-follow-actions' }),
      ).toHaveLength(0);
      await click('Profile options');
      expect(
        renderer.root
          .findAllByProps({ role: 'menuitem' })
          .map((item) => item.children.join('')),
      ).toEqual(['Unfollow', 'Block account']);
      await click(label);
    }
    await open();
    expect(requests.some((item) => item.options?.method === 'POST')).toBe(
      false,
    );
    await click('Cancel');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await open();
    await act(async () =>
      renderer.root
        .findByType('dialog')
        .props.onCancel({ preventDefault: vi.fn() }),
    );
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(requests.some((item) => item.options?.method === 'POST')).toBe(
      false,
    );
    await open();
    await confirmAction(label);
    expect(renderer.root.findByType('dialog').props['aria-busy']).toBe(true);
    expect(
      renderer.root
        .findByType('dialog')
        .findAllByType('button')
        .every((button) => button.props.disabled),
    ).toBe(true);
    // Escape and repeated submission cannot interrupt or duplicate the mutation.
    await act(async () => {
      renderer.root
        .findByType('dialog')
        .props.onCancel({ preventDefault: vi.fn() });
      renderer.root
        .findByType('dialog')
        .findAllByType('button')
        .at(-1)!
        .props.onClick();
    });
    expect(
      requests.filter((item) => item.options?.method === 'POST'),
    ).toHaveLength(1);
    await reply(
      pending(`/api/people/bob/${action}`),
      { error: 'Please retry' },
      503,
    );
    expect(
      renderer.root.findByType('dialog').findByProps({ role: 'alert' })
        .children,
    ).toEqual(['Please retry']);
    await confirmAction(label);
    await reply(pending(`/api/people/bob/${action}`), { ok: true });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    if (action === 'block') expect(location.hash).toBe('people');
    else {
      await reply(pending('/api/people/bob'), {
        profile: {
          handle: 'bob',
          displayName: 'Bob',
          bio: null,
          relationship: 'none',
        },
      });
      expect(visibleText()).toContain('This account is private');
      expect(visibleText()).toContain('Request to follow');
      await click('Profile options');
      expect(
        renderer.root
          .findAllByProps({ role: 'menuitem' })
          .map((item) => item.children.join('')),
      ).toEqual(['Block account']);
    }
  },
);

it('saves an edited username and updates own-profile navigation after a conflict retry', async () => {
  location.hash = '#edit';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const field = renderer.root.findByProps({ id: 'handle' });
  expect(field.props.disabled).toBe(false);
  await act(async () =>
    field.props.onChange({ target: { value: 'alice_new' } }),
  );
  async function save() {
    await act(async () =>
      renderer.root
        .findByType('form')
        .props.onSubmit({ preventDefault: vi.fn() }),
    );
  }
  await save();
  await reply(
    pending('/api/people/self'),
    { error: 'That username is unavailable.' },
    409,
  );
  expect(field.props.value).toBe('alice_new');
  await save();
  await reply(pending('/api/people/self'), {
    profile: { ...ownProfile, handle: 'alice_new' },
  });
  await go(location.hash);
  expect(location.hash).toBe('#profile/alice_new');
  expect(
    renderer.root.findByProps({ 'aria-label': 'Profile' }).props.href,
  ).toBe('#profile/alice_new');
});

it('does not keep the empty invitation message or old cancellation status after successful mutations', async () => {
  await mount(createElement(InvitationForm));
  await reply(pending('/api/invitations?'), { items: [], next: null });
  await act(async () => {
    renderer.root
      .findByProps({ id: 'invite-email' })
      .props.onChange({ target: { value: 'friend@example.com' } });
  });
  await act(async () => {
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  await reply(pending('/api/invitations'), { ok: true });
  expect(visibleText()).toContain('Invitation emailed to');
  expect(visibleText()).toContain('Loading invitations…');
  expect(visibleText()).not.toContain('No invitations yet.');
  await reply(pending('/api/invitations?'), {
    items: [
      {
        id: 'invite',
        email: 'friend@example.com',
        createdAt: 1,
        accepted: false,
        expired: false,
        revokedAt: null,
      },
    ],
    next: null,
  });
  await click('Cancel invitation');
  await reply(pending('/api/invitations/invite'), { ok: true });
  expect(visibleText()).toContain('Loading invitations…');
  expect(visibleText()).not.toContain('Waiting to join');
  expect(visibleText()).not.toContain('Invitation emailed to');
});

async function selectTab(label: string, modified = false) {
  const link = renderer.root
    .findAllByType('a')
    .find((item) => item.props['aria-label'] === label)!;
  const event = {
    button: 0,
    ctrlKey: modified,
    defaultPrevented: false,
    preventDefault: vi.fn(),
  };
  await act(async () => {
    link.props.onClick(event);
    if (
      !modified &&
      !event.preventDefault.mock.calls.length &&
      location.hash !== link.props.href
    ) {
      location.hash = link.props.href;
      window.dispatchEvent(new Event('hashchange'));
    }
  });
  return event;
}

it('reselecting Feed reloads the newest page without another account read or a persistent refresh button', async () => {
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending('/api/posts?'), {
    items: [post('first')],
    next: 'older',
  });
  await click('Older');
  await reply(pending('/api/posts?cursor=older'), {
    items: [post('older')],
    next: null,
  });
  expect(visibleText()).toContain('Photo older');
  expect(visibleText()).not.toContain('Refresh posts');
  const event = await selectTab('Feed');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(visibleText()).toContain('Loading posts…');
  expect(visibleText()).not.toContain('Photo older');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'End of posts' }),
  ).toHaveLength(0);
  expect(pending('/api/posts?').path).toBe('/api/posts?');
  expect(
    requests.filter((item) => item.path === '/api/people/self'),
  ).toHaveLength(0);
});

it.each([
  {
    route: '#notifications',
    label: 'Activity',
    path: '/api/notifications?',
    data: { items: [], next: null },
    loading: 'Loading notifications…',
  },
  {
    route: '#profile/alice',
    label: 'Profile',
    path: '/api/people/alice',
    data: { profile: { ...ownProfile, relationship: 'self' } },
    loading: 'Loading profile…',
  },
  {
    route: '#profile',
    label: 'Profile',
    path: '/api/people/alice',
    data: { profile: { ...ownProfile, relationship: 'self' } },
    loading: 'Loading profile…',
  },
])(
  'reselecting $route fetches current data in the installed app',
  async ({ route, label, path, data, loading }) => {
    location.hash = route;
    vi.stubGlobal('navigator', { standalone: true });
    await mount(
      createElement(MemberApp, {
        initialProfile: ownProfile,
        onSignOut: vi.fn(),
        signingOut: false,
      }),
    );
    await reply(pending(path), data);
    const event = await selectTab(label);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(visibleText()).toContain(loading);
    expect(pending(path)).toBeDefined();
    expect(visibleText()).not.toContain('Refresh notifications');
  },
);

it('preserves draft input and normal modified navigation when a tab is selected again', async () => {
  location.hash = '#compose';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await act(async () => {
    renderer.root
      .findByProps({ id: 'caption' })
      .props.onChange({ target: { value: 'Keep this draft' } });
  });
  const compose = await selectTab('New post');
  expect(compose.preventDefault).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ id: 'caption' }).props.value).toBe(
    'Keep this draft',
  );
  await selectTab('Feed');
  await reply(pending('/api/posts?'), { items: [], next: null });
  const count = requests.length;
  const modified = await selectTab('Feed', true);
  expect(modified.preventDefault).not.toHaveBeenCalled();
  expect(requests).toHaveLength(count);
});

it('Profile navigates home from another member and Settings provides the only full-app reload control', async () => {
  location.hash = '#profile/bob';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  const event = await selectTab('Profile');
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(location.hash).toBe('#profile/alice');
  expect(pending('/api/people/alice')).toBeDefined();
  expect(visibleText()).not.toContain('Reload app');
  await act(async () => {
    location.hash = '#settings';
    window.dispatchEvent(new Event('hashchange'));
  });
  await click('Reload app');
  expect(location.reload).toHaveBeenCalledOnce();
});

it('paginates one activity timeline and resolves inline requests without leaving the page', async () => {
  location.hash = '#notifications';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending('/api/notifications?'), {
    items: [
      {
        key: 'likes:one-0123456789ab',
        kind: 'likes',
        postId: 'one',
        count: 1,
        more: true,
        createdAt: 4,
      },
      {
        key: 'request:bob',
        kind: 'request',
        handle: 'bob',
        createdAt: 3,
      },
      {
        key: 'likes:one',
        kind: 'likes',
        postId: 'one',
        count: 2,
        more: false,
        createdAt: 2,
      },
      {
        key: 'comment:one',
        kind: 'comment',
        postId: 'two',
        handle: 'carol',
        body: 'Hello',
        createdAt: 1,
      },
    ],
    next: 'older',
  });
  expect(visibleText()).toMatch(/1\s+more\s+person likes/);
  expect(visibleText()).toMatch(/2\s+people like/);
  expect(visibleText()).not.toMatch(/2\s+more/);
  expect(visibleText()).toContain('requested to follow you');
  expect(visibleText()).toContain('Hello');
  expect(visibleText()).not.toMatch(/Unread|Mark this page/);
  expect(
    requests.every(
      (item) => !item.options?.method || item.options.method === 'GET',
    ),
  ).toBe(true);
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Activity filters' }),
  ).toHaveLength(0);
  expect(renderer.root.findByProps({ href: '#profile/bob' })).toBeDefined();
  expect(visibleText()).not.toContain('View post');
  const activityRows = renderer.root
    .findByProps({ className: 'notification-list' })
    .findAllByType('li');
  for (const [index, id] of [
    [0, 'one'],
    [2, 'one'],
    [3, 'two'],
  ] as const) {
    const row = activityRows[index];
    const link = row.findByType('a');
    expect(row.children).toEqual([link]);
    expect(link.props.href).toBe(`#post/${id}`);
    expect(link.findByType('img').props).toMatchObject({
      src: `/media/posts/${id}?size=grid`,
      alt: '',
      width: 64,
      height: 64,
      loading: 'lazy',
    });
    expect(link.findAllByType('button')).toHaveLength(0);
    expect(link.findByType('time')).toBeDefined();
  }
  expect(activityRows[1].findAllByType('button')).toHaveLength(2);
  await click('Accept');
  await reply(pending('/api/people/bob/accept'), { ok: true });
  expect(location.hash).toBe('#notifications');
  expect(pending('/api/notifications?').path).toBe(
    '/api/notifications?cursor=&includeJoined=1',
  );
  await reply(pending('/api/notifications?'), { items: [], next: 'older' });
  await click('Older');
  await reply(pending('/api/notifications?cursor=older'), {
    items: [],
    next: null,
  });
  expect(visibleText()).toContain('No activity on this page.');
  await click('Newer');
  expect(pending('/api/notifications?').path).toBe(
    '/api/notifications?cursor=&includeJoined=1',
  );
  expect(
    requests.some(
      (item) =>
        item.path.includes('filter=') ||
        item.path.includes('/connections') ||
        item.path.includes('/notifications/read'),
    ),
  ).toBe(false);
});

it('opens older follow-request links in Activity', async () => {
  location.hash = '#requests';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(renderer.root.findByType('h1').children).toEqual(['Activity']);
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Activity filters' }),
  ).toHaveLength(0);
  expect(pending('/api/notifications?')).toBeDefined();
  const event = await selectTab('Activity');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(requests.some((item) => item.path.includes('/connections'))).toBe(
    false,
  );
});

async function go(hash: string) {
  await act(async () => {
    location.hash = hash;
    window.dispatchEvent(new Event('hashchange'));
  });
}

it.each([
  { route: '#feed', label: 'Feed', path: '/api/posts?' },
  {
    route: '#profile/alice',
    label: 'Profile',
    path: '/api/posts?handle=alice',
  },
  {
    route: '#notifications',
    label: 'Activity',
    path: '/api/notifications?',
  },
])(
  'opens a separate post page from $label and returns to its current pagination cursor',
  async ({ route, label, path }) => {
    location.hash = route;
    await mount(
      createElement(MemberApp, {
        initialProfile: ownProfile,
        onSignOut: vi.fn(),
        signingOut: false,
      }),
    );
    async function loadProfile() {
      if (label === 'Profile')
        await reply(pending('/api/people/alice'), {
          profile: { ...ownProfile, relationship: 'self' },
        });
    }
    function item(id: string) {
      return label === 'Activity'
        ? {
            key: `likes:${id}`,
            kind: 'likes',
            postId: id,
            count: 1,
            createdAt: 1,
          }
        : post(id);
    }
    await loadProfile();
    await reply(pending(path), { items: [item('first')], next: 'older' });
    await click('Older');
    await reply(pending(path), { items: [item('second')], next: null });
    await go(renderer.root.findByProps({ href: '#post/second' }).props.href);
    expect(renderer.root.findByType('h1').children).toEqual(['Post']);
    expect(renderer.root.findAllByType(PostList)).toHaveLength(0);
    expect(renderer.root.findAllByType(ProfilePage)).toHaveLength(0);
    expect(renderer.root.findAllByType(Notifications)).toHaveLength(0);
    expect(visibleText()).toContain('Loading photo…');
    await reply(pending('/api/posts/second'), { post: post('second') });
    await reply(pending('/api/interactions/second/comments?'), {
      items: [],
      next: null,
    });
    expect(renderer.root.findAllByType('article')).toHaveLength(1);
    expect(renderer.root.findByType('textarea').props.rows).toBe(1);
    expect(renderer.root.findAllByProps({ href: '#post/second' })).toHaveLength(
      0,
    );
    const back = renderer.root.findByProps({ className: 'back-control' });
    expect(back.props.href).toBe(route);
    expect(back.children.join(' ')).toContain(`Back to ${label.toLowerCase()}`);
    await go(back.props.href);
    await loadProfile();
    const returned = pending(path);
    expect(
      new URL(returned.path, location.origin).searchParams.get('cursor'),
    ).toBe('older');
    expect(visibleText()).not.toContain('Photo second');
    await reply(returned, { items: [item('second')], next: null });
    await click('Newer');
    const newer = pending(path);
    expect(
      new URL(newer.path, location.origin).searchParams.get('cursor') || '',
    ).toBe('');
    await reply(newer, { items: [item('first')], next: 'older' });
    await click('Older');
    await reply(pending(path), { items: [], next: null });
    await selectTab(label);
    const refreshed = requests[requests.length - 1];
    expect(refreshed.options?.signal?.aborted).not.toBe(true);
    await loadProfile();
    expect(
      new URL(pending(path).path, location.origin).searchParams.get('cursor') ||
        '',
    ).toBe('');
  },
);

it('supports direct post links, safe back navigation, unavailable posts, and retry', async () => {
  location.hash = '#post/direct';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(renderer.root.findByType('h1').children).toEqual(['Post']);
  expect(
    renderer.root.findByProps({ className: 'back-control' }).props.href,
  ).toBe('#feed');
  await reply(pending('/api/posts/direct'), { error: 'Post not found.' }, 404);
  expect(visibleText()).toContain('Post not found.');
  expect(renderer.root.findAllByType('article')).toHaveLength(0);
  expect(requests.some((request) => request.path.includes('/comments'))).toBe(
    false,
  );
  await click('Retry');
  await reply(pending('/api/posts/direct'), {
    post: { ...post('direct'), handle: 'bob' },
  });
  await go(renderer.root.findByProps({ href: '#profile/bob' }).props.href);
  expect(renderer.root.findAllByType(PostDetail)).toHaveLength(0);
  expect(
    pending('/api/interactions/direct/comments?').options?.signal?.aborted,
  ).toBe(true);
  const back = renderer.root.findByProps({ className: 'back-control' });
  expect(back.props.href).toBe('#post/direct');
  expect(back.children.join(' ')).toContain('Back to post');
  await go(back.props.href);
  expect(visibleText()).toContain('Loading photo…');
  expect(pending('/api/posts/direct')).toBeDefined();
});

it('deletes a focused post and refetches the originating feed when returning', async () => {
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending('/api/posts?'), { items: [post('mine')], next: null });
  await go('#post/mine');
  await reply(pending('/api/posts/mine'), {
    post: { ...post('mine'), isOwner: true },
  });
  await click('Post options');
  await click('Delete post');
  await act(async () => {
    renderer.root
      .findByType('dialog')
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  const deletion = pending('/api/posts/mine');
  expect(deletion.options?.method).toBe('DELETE');
  await reply(deletion, { ok: true });
  expect(visibleText()).toContain('Photo deleted.');
  expect(renderer.root.findAllByType('article')).toHaveLength(0);
  await go(renderer.root.findByProps({ className: 'back-control' }).props.href);
  await reply(pending('/api/posts?'), { items: [], next: null });
  expect(visibleText()).not.toContain('Photo mine');
  expect(visibleText()).toContain('No posts on this page.');
});

it('submits compact comments once, preserves failed drafts, and reuses the operation ID on retry', async () => {
  await mount(
    createElement(Interactions, {
      postId: 'one',
      initial: { likeCount: 0, commentCount: 0, liked: 0 },
    }),
  );
  await click('Show comments');
  await reply(pending('/api/interactions/one/comments?'), {
    items: [],
    next: null,
  });
  const field = renderer.root.findByType('textarea');
  expect(
    renderer.root.findByProps({ htmlFor: field.props.id }).children,
  ).toEqual(['Add a comment']);
  expect(
    renderer.root.findByProps({ 'aria-label': 'Post comment' }).props.disabled,
  ).toBe(true);
  await act(async () => {
    field.props.onChange({ target: { value: 'Hello\nfriend' } });
  });
  async function submit() {
    await act(async () => {
      renderer.root
        .findByType('form')
        .props.onSubmit({ preventDefault: vi.fn() });
    });
  }
  await submit();
  const first = pending('/api/interactions/one/comments');
  const payload = JSON.parse(String(first.options?.body));
  expect(payload.body).toBe('Hello\nfriend');
  expect(
    renderer.root.findByProps({ 'aria-label': 'Posting comment' }).props
      .disabled,
  ).toBe(true);
  await submit();
  expect(
    requests.filter((request) => request.options?.method === 'POST'),
  ).toHaveLength(1);
  await reply(first, { error: 'Try again' }, 503);
  expect(field.props.value).toBe('Hello\nfriend');
  expect(visibleText()).toContain('Try again');
  await submit();
  const retried = pending('/api/interactions/one/comments');
  expect(JSON.parse(String(retried.options?.body))).toEqual(payload);
  await reply(retried, { ok: true });
  await reply(pending('/api/posts/one'), {
    post: { likeCount: 0, commentCount: 1, liked: 0 },
  });
  expect(field.props.value).toBe('');
  await reply(pending('/api/interactions/one/comments?'), {
    items: [],
    next: null,
  });
  await act(async () => {
    field.props.onChange({ target: { value: 'Another comment' } });
  });
  await submit();
  const next = JSON.parse(
    String(pending('/api/interactions/one/comments').options?.body),
  );
  expect(next.id).not.toBe(payload.id);
});

it('keeps profile information mounted across tabs and returns to the selected tab after a person visit', async () => {
  location.hash = '#people';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await go('#profile/alice');
  await reply(pending('/api/people/alice'), {
    profile: { ...ownProfile, relationship: 'self' },
  });
  expect(
    renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
  ).toBe('posts');
  const header = renderer.root.findByProps({ className: 'profile-header-row' });
  expect(header.findByProps({ className: 'profile-identity' }).parent).toBe(
    header,
  );
  expect(header.findByProps({ className: 'profile-shortcuts' }).parent).toBe(
    header,
  );
  expect(
    renderer.root
      .findByProps({ className: 'profile-shortcuts' })
      .findByProps({ 'aria-label': 'Settings' }).props.href,
  ).toBe('#settings');
  expect(
    renderer.root.findByProps({ className: 'sidebar-footer' }).findByType('a')
      .props.href,
  ).toBe('#settings');
  expect(
    renderer.root.findAllByProps({ className: 'back-control' }),
  ).toHaveLength(0);
  for (const label of ['Following', 'Followers']) {
    await click(label);
    await go(location.hash);
    const kind = label.toLowerCase();
    expect(location.hash).toBe(`#profile/alice/${kind}`);
    expect(renderer.root.findByType('h2').children.join('')).toBe('@alice');
    expect(
      renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
    ).toBe(kind);
    await reply(pending(`/api/people/connections?kind=${kind}`), {
      items: [{ handle: 'bob', displayName: 'Bob' }],
      next: null,
    });
    expect(renderer.root.findAllByType(PostList)).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ className: 'back-control' }),
    ).toHaveLength(0);
  }
  expect(
    requests.filter((item) => item.path === '/api/people/alice'),
  ).toHaveLength(1);
  await go(renderer.root.findByProps({ href: '#profile/bob' }).props.href);
  await reply(pending('/api/people/bob'), {
    profile: {
      ...ownProfile,
      handle: 'bob',
      relationship: 'pending',
      bio: null,
    },
  });
  expect(renderer.root.findAllByProps({ role: 'tablist' })).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ className: 'profile-shortcuts' }),
  ).toHaveLength(0);
  expect(visibleText()).toContain('This account is private');
  const back = renderer.root.findByProps({ className: 'back-control' });
  expect(back.props.href).toBe('#profile/alice/followers');
  await go(back.props.href);
  await reply(pending('/api/people/alice'), {
    profile: { ...ownProfile, relationship: 'self' },
  });
  expect(
    renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
  ).toBe('followers');
  expect(
    renderer.root.findAllByProps({ className: 'back-control' }),
  ).toHaveLength(0);
});

it.each(['following', 'followers'] as const)(
  'opens another member’s %s tab, paginates read-only rows, and returns from a person visit',
  async (kind) => {
    location.hash = '#people';
    await mount(
      createElement(MemberApp, {
        initialProfile: ownProfile,
        onSignOut: vi.fn(),
        signingOut: false,
      }),
    );
    await go('#profile/bob');
    const profile = { ...ownProfile, handle: 'bob', relationship: 'accepted' };
    await reply(pending('/api/people/bob'), { profile });
    const header = renderer.root.findByProps({
      className: 'profile-header-row',
    });
    expect(
      renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
    ).toBe('posts');
    await click(kind === 'following' ? 'Following' : 'Followers');
    await go(location.hash);
    expect(location.hash).toBe(`#profile/bob/${kind}`);
    expect(renderer.root.findByProps({ className: 'profile-header-row' })).toBe(
      header,
    );
    const path = `/api/people/bob/connections?kind=${kind}&after=`;
    await reply(pending(path), { error: 'Please retry' }, 503);
    expect(visibleText()).not.toContain('No accounts on this page.');
    await click('Retry');
    expect(visibleText()).not.toContain('Please retry');
    await reply(pending(path), {
      items: [{ handle: 'carol', displayName: 'Carol' }],
      next: 'carol',
    });
    const row = renderer.root.findByProps({ className: 'connection-row' });
    expect(row.findAllByType('button')).toHaveLength(0);
    expect(row.findByType('img').props.src).toBe('/media/avatar/carol');
    await click('Next');
    expect(visibleText()).not.toContain('@carol');
    await reply(pending(`${path}carol`), { items: [], next: null });
    expect(visibleText()).toContain('No accounts on this page.');
    await click('Previous');
    await reply(pending(path), {
      items: [{ handle: 'carol', displayName: 'Carol' }],
      next: 'carol',
    });
    expect(
      requests.filter((item) => item.path === '/api/people/bob'),
    ).toHaveLength(1);
    expect(
      requests.some((item) => item.path.startsWith('/api/people/connections')),
    ).toBe(false);
    await go(renderer.root.findByProps({ href: '#profile/carol' }).props.href);
    await reply(pending('/api/people/carol'), {
      profile: {
        ...ownProfile,
        handle: 'carol',
        relationship: 'none',
        bio: null,
      },
    });
    const back = renderer.root.findByProps({ className: 'back-control' });
    expect(back.props.href).toBe(`#profile/bob/${kind}`);
    await go(back.props.href);
    await reply(pending('/api/people/bob'), { profile });
    expect(
      renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
    ).toBe(kind);
    await reply(
      pending(path),
      { error: 'Follow this account to view its connections.' },
      404,
    );
    expect(visibleText()).not.toContain('@carol');
    expect(visibleText()).toContain(
      'Follow this account to view its connections.',
    );
  },
);

it.each(['none', 'pending'])(
  'hides other-profile tabs and connection reads when the relationship is %s',
  async (relationship) => {
    await mount(
      createElement(ProfilePage, { handle: 'bob', tab: 'followers' }),
    );
    await reply(pending('/api/people/bob'), {
      profile: { ...ownProfile, handle: 'bob', bio: null, relationship },
    });
    expect(renderer.root.findAllByProps({ role: 'tablist' })).toHaveLength(0);
    expect(visibleText()).toContain('This account is private');
    expect(requests.some((item) => item.path.includes('/connections'))).toBe(
      false,
    );
  },
);

it('supports profile tab keyboard navigation without a back link on your own profile', async () => {
  location.hash = '#profile/alice';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await reply(pending('/api/people/alice'), {
    profile: { ...ownProfile, relationship: 'self' },
  });
  const shortcuts = renderer.root.findByProps({
    className: 'profile-shortcuts',
  });
  expect(
    shortcuts.findAllByType('a').map((a) => a.props['aria-label']),
  ).toEqual(['Invite friends', 'Settings']);
  expect(
    renderer.root.findAllByProps({ className: 'back-control' }),
  ).toHaveLength(0);
  for (const [key, expected] of [
    ['ArrowRight', 'following'],
    ['End', 'followers'],
    ['ArrowRight', 'posts'],
    ['ArrowLeft', 'followers'],
    ['Home', 'posts'],
  ]) {
    const event = { key, preventDefault: vi.fn() };
    await act(async () => {
      renderer.root
        .findByProps({ role: 'tab', 'aria-selected': true })
        .props.onKeyDown(event);
    });
    await go(location.hash);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(
      renderer.root.findByProps({ role: 'tabpanel' }).props['data-tab'],
    ).toBe(expected);
    expect(
      renderer.root.findAllByProps({ role: 'tab', tabIndex: 0 }),
    ).toHaveLength(1);
  }
});

it.each([false, true])(
  'keeps caption editing in the owner menu and saves in place (focused: %s)',
  async (focused) => {
    await mount(
      focused
        ? createElement(PostDetail, { id: 'mine' })
        : createElement(PostList),
    );
    const mine = { ...post('mine'), isOwner: true };
    await reply(
      pending(focused ? '/api/posts/mine' : '/api/posts?'),
      focused ? { post: mine } : { items: [mine], next: null },
    );
    expect(renderer.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0);
    await click('Post options');
    expect(
      renderer.root
        .findByProps({ role: 'menu' })
        .findAllByProps({ role: 'menuitem' }),
    ).toHaveLength(2);
    await click('Edit caption');
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    const dialog = renderer.root.findByType('dialog');
    expect(dialog.findAllByProps({ type: 'file' })).toHaveLength(0);
    await act(async () => {
      dialog
        .findByType('textarea')
        .props.onChange({ target: { value: 'Updated caption' } });
    });
    async function save() {
      await act(async () => {
        dialog.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
      });
    }
    await save();
    let request = pending('/api/posts/mine');
    expect(request.options?.method).toBe('PATCH');
    expect(JSON.parse(String(request.options?.body))).toEqual({
      caption: 'Updated caption',
    });
    await reply(request, { error: 'Please retry' }, 503);
    expect(dialog.findByType('textarea').props.value).toBe('Updated caption');
    await save();
    request = pending('/api/posts/mine');
    await reply(request, { caption: 'Updated caption' });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(visibleText()).toContain('Updated caption');
    expect(visibleText()).not.toContain('Photo mine');
    await click('Post options');
    await click('Edit caption');
    expect(
      renderer.root.findByType('dialog').findByType('textarea').props.value,
    ).toBe('Updated caption');
    await click('Cancel');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  },
);

it('shows flat comments with avatars, relative times, likes, and a modal likers list', async () => {
  await mount(
    createElement(Interactions, {
      postId: 'one',
      initial: { likeCount: 2, liked: 0, commentCount: 1 },
      commentsInitiallyOpen: true,
    }),
  );
  await reply(pending('/api/interactions/one/comments?'), {
    items: [
      {
        id: 'comment',
        handle: 'bob',
        body: 'Hello',
        createdAt: Date.now() - 8 * 60000,
        canDelete: 0,
        likeCount: 0,
        liked: 0,
      },
    ],
    next: null,
  });
  expect(
    renderer.root.findByProps({ className: 'comment-avatar' }).props.href,
  ).toBe('#profile/bob');
  expect(visibleText()).toContain('8m');
  expect(visibleText()).not.toContain('Reply');
  await click('Like comment');
  const like = pending('/api/interactions/comments/comment/like');
  expect(like.options?.method).toBe('PUT');
  await reply(like, { likeCount: 1, liked: 1 });
  expect(
    renderer.root.findByProps({ 'aria-label': 'Unlike comment' }).props[
      'aria-pressed'
    ],
  ).toBe(true);
  await click('See 1 comment likes');
  await reply(pending('/api/interactions/comments/comment/likes?'), {
    items: [{ handle: 'alice' }],
    next: 'alice',
  });
  expect(
    renderer.root.findByType('dialog').findByProps({ href: '#profile/alice' }),
  ).toBeDefined();
  await click('Next');
  expect(
    pending('/api/interactions/comments/comment/likes?after=alice'),
  ).toBeDefined();
  await click('Close liked by');
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(
    pending('/api/interactions/comments/comment/likes?after=alice').options
      ?.signal?.aborted,
  ).toBe(true);
  await click('See 2 likes');
  await reply(pending('/api/interactions/one/likes?'), {
    items: [{ handle: 'bob' }],
    next: null,
  });
  expect(
    renderer.root.findByType('dialog').findByProps({ href: '#profile/bob' }),
  ).toBeDefined();
  await act(async () => {
    renderer.root
      .findByType('dialog')
      .props.onCancel({ preventDefault: vi.fn() });
  });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
});

it('returns from the profile invite shortcut and exposes explicit retry for failed invitation email', async () => {
  location.hash = '#profile/alice';
  await mount(
    createElement(MemberApp, {
      initialProfile: ownProfile,
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  await go('#invitations');
  expect(
    renderer.root.findByProps({ className: 'back-control' }).props.href,
  ).toBe('#profile/alice');
  await reply(pending('/api/invitations?'), {
    items: [
      {
        id: 'invite',
        email: 'friend@example.com',
        createdAt: 1,
        sentAt: null,
        attemptedAt: 1,
        accepted: false,
        expired: false,
        revokedAt: null,
      },
    ],
    next: null,
  });
  expect(visibleText()).toContain('Email delivery unconfirmed');
  expect(visibleText()).not.toContain('Copy invitation');
  await click('Retry email');
  expect(pending('/api/invitations/invite/send').options?.method).toBe('POST');
  await reply(pending('/api/invitations/invite/send'), { ok: true });
  expect(visibleText()).toContain('Loading invitations…');
});

it('resizes an original over 8 MB before posting and reuses the encoded photo on retry', async () => {
  const onPublished = vi.fn();
  const original = new File([new Uint8Array(12 * 1024 * 1024)], 'test.jpg', {
    type: 'image/jpeg',
  });
  const encoded = new Blob(['cropped'], { type: 'image/webp' });
  const drawImage = vi.fn();
  const toBlob = vi.fn((callback: BlobCallback) => callback(encoded));
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob,
  };
  Object.assign(document, { createElement: () => canvas });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 6000, height: 4000, close: vi.fn() }),
  );
  await mount(createElement(Compose, { onPublished }));
  expect(renderer.root.findAllByProps({ id: 'alt-text' })).toHaveLength(0);
  await act(async () => {
    renderer.root
      .findByProps({ id: 'caption' })
      .props.onChange({ target: { value: 'Test caption' } });
    renderer.root.findByProps({ id: 'post-file' }).props.onChange({
      target: {
        files: [original],
      },
    });
  });
  await click('Use photo');
  expect([canvas.width, canvas.height]).toEqual([1600, 1067]);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
  await click('Adjust crop');
  expect(renderer.root.findByType(PostCropEditor).props.file).toBe(original);
  expect(renderer.root.findByType(PostCropEditor).props.initial).toEqual(
    fullPhoto,
  );
  await act(async () =>
    renderer.root.findByType(PostCropEditor).props.onClose(),
  );
  expect(renderer.root.findByProps({ id: 'caption' }).props.value).toBe(
    'Test caption',
  );
  await act(async () => {
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  const draft = pending('/api/posts');
  const body = JSON.parse(draft.options!.body as string);
  expect(body).toMatchObject({ caption: 'Test caption', altText: '' });
  await reply(draft, { state: 'pending' });
  const upload = pending(`/api/posts/${body.id}/photo`);
  const cropped = upload.options?.body;
  expect(cropped).toBeInstanceOf(File);
  expect(await (cropped as File).text()).toBe('cropped');
  expect(upload.options?.headers).toEqual({ 'Content-Type': 'image/webp' });
  expect(upload.options?.method).toBe('PUT');
  await reply(upload, { error: 'Please retry' }, 503);
  await act(async () => {
    const submit = renderer.root.findByType('form').props.onSubmit;
    submit({ preventDefault: vi.fn() });
    submit({ preventDefault: vi.fn() });
  });
  const retry = pending('/api/posts');
  expect(JSON.parse(String(retry.options?.body)).id).toBe(body.id);
  expect(requests.filter((request) => !request.settled)).toHaveLength(1);
  await reply(retry, { state: 'pending' });
  const retriedUpload = pending(`/api/posts/${body.id}/photo`);
  expect(retriedUpload.options?.body).toBe(cropped);
  await reply(retriedUpload, { ok: true });
  expect(onPublished).toHaveBeenCalledOnce();
});

it('returns to sign-in when the mounted session expires instead of offering an endless retry', async () => {
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), signedIn);
  await reply(pending('/api/posts'), { error: 'Sign in to continue.' }, 401);
  expect(visibleText()).toContain(
    'Your session has expired. Sign in again to continue.',
  );
  expect(
    renderer.root
      .findAllByType('input')
      .some((input) => input.props.type === 'email'),
  ).toBe(true);
  expect(visibleText()).not.toContain('Retry');
  expect(
    requests.filter((item) => item.path === '/api/bootstrap'),
  ).toHaveLength(1);
});
it('keeps the signed-in session on temporary server failures', async () => {
  await mount(createElement(Welcome));
  await reply(pending('/api/bootstrap'), signedIn);
  await reply(pending('/api/posts'), { error: 'Unavailable' }, 503);
  noLogin();
  expect(visibleText()).toContain('Unavailable');
  await click('Retry');
  await reply(pending('/api/posts'), { items: [], next: null });
  noLogin();
});

it.each([false, true])(
  'confirms comment deletion in expanded=%s views with an accessible trash icon and failure recovery',
  async (commentsInitiallyOpen) => {
    await mount(
      createElement(Interactions, {
        postId: 'one',
        initial: { likeCount: 0, liked: 0, commentCount: 2 },
        commentsInitiallyOpen,
      }),
    );
    if (!commentsInitiallyOpen) await click('Show comments');
    const comment = {
      id: 'target',
      handle: 'bob',
      displayName: 'Bob',
      body: 'Hello',
      createdAt: 1,
      canDelete: 1,
      likeCount: 0,
      liked: 0,
    };
    const other = { ...comment, id: 'other', canDelete: 0 };
    await reply(pending('/api/interactions/one/comments?'), {
      items: [other, comment],
      next: null,
    });
    const remainingAvatar = renderer.root.findAllByType('img')[0];
    const buttons = renderer.root.findAllByProps({
      'aria-label': 'Delete comment',
    });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].findByType('svg').props['aria-hidden']).toBe('true');
    expect(visibleText()).not.toContain('Delete comment');
    await click('Delete comment');
    expect(requests.some((item) => item.options?.method === 'DELETE')).toBe(
      false,
    );
    await click('Cancel');
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    await click('Delete comment');
    await confirmAction('Delete comment');
    const deletion = pending('/api/interactions/comments/target');
    expect(deletion.options?.method).toBe('DELETE');
    expect(
      renderer.root
        .findByType('dialog')
        .findAllByType('button')
        .every((button) => button.props.disabled),
    ).toBe(true);
    await act(async () => {
      renderer.root
        .findByType('dialog')
        .props.onCancel({ preventDefault: vi.fn() });
      renderer.root
        .findByType('dialog')
        .findAllByType('button')
        .at(-1)!
        .props.onClick();
    });
    expect(
      requests.filter((item) => item.options?.method === 'DELETE'),
    ).toHaveLength(1);
    await reply(deletion, { error: 'Please retry' }, 503);
    expect(
      renderer.root.findByType('dialog').findByProps({ role: 'alert' })
        .children,
    ).toEqual(['Please retry']);
    await confirmAction('Delete comment');
    await reply(pending('/api/interactions/comments/target'), { ok: true });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(renderer.root.findAllByType('img')).toEqual([remainingAvatar]);
    await reply(pending('/api/interactions/one/comments?'), {
      items: [{ ...other, likeCount: 2, liked: 1 }],
      next: null,
    });
    expect(renderer.root.findByType('img')).toBe(remainingAvatar);
    expect(
      renderer.root.findByProps({ 'aria-label': 'See 2 comment likes' }),
    ).toBeDefined();
    await reply(pending('/api/posts/one'), {
      post: { likeCount: 0, liked: 0, commentCount: 1 },
    });
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Delete comment' }),
    ).toHaveLength(0);
    expect(
      requests
        .filter((item) => item.options?.method === 'DELETE')
        .every((item) => item.path === '/api/interactions/comments/target'),
    ).toBe(true);
  },
);

it('offers one copy action before email invitations and preserves the request ID on retry', async () => {
  await mount(createElement(InvitationForm));
  await reply(pending('/api/invite-link'), { link: null });
  await reply(pending('/api/invitations?'), { items: [], next: null });
  expect(visibleText().indexOf('Share an invite link')).toBeLessThan(
    visibleText().indexOf('Invite by email'),
  );
  expect(visibleText()).not.toContain('100 sign-ups');
  expect(visibleText()).not.toContain('Your invite links');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Link options' }),
  ).toHaveLength(0);
  expect(
    requests.every(
      (request) => !request.options?.method || request.options.method === 'GET',
    ),
  ).toBe(true);
  await click('Copy invite link');
  const first = pending('/api/invite-link/copy');
  const body = JSON.parse(String(first.options?.body));
  expect(body).toEqual({ id: expect.any(String) });
  await reply(first, { error: 'Please retry' }, 503);
  await reply(pending('/api/invite-link'), { link: null });
  await click('Copy invite link');
  expect(
    JSON.parse(String(pending('/api/invite-link/copy').options?.body)),
  ).toEqual(body);
  await reply(pending('/api/invite-link/copy'), {
    id: body.id,
    expiresAt: Date.now() + 604800000,
    url: 'https://slowmass.com/invite#synthetic',
  });
  expect(renderer.root.findByProps({ id: 'invite-link-url' }).props.value).toBe(
    'https://slowmass.com/invite#synthetic',
  );
  expect(visibleText()).toContain('Select and copy the link below.');
});

it('keeps replacement in the overflow menu, confirms it, and retries the same version operation', async () => {
  const expiresAt = Date.now() + 604800000;
  await mount(createElement(InvitationForm));
  await reply(pending('/api/invite-link'), {
    link: { id: 'existing', expiresAt, available: true },
  });
  await reply(pending('/api/invitations?'), { items: [], next: null });
  expect(renderer.root.findByType('time').props.dateTime).toBe(
    new Date(expiresAt).toISOString(),
  );
  expect(visibleText()).not.toContain('Replace link');
  await click('Link options');
  expect(renderer.root.findByProps({ role: 'menuitem' }).children).toEqual([
    'Replace link',
  ]);
  await click('Replace link');
  expect(visibleText()).toContain('Your previous link will stop working');
  expect(
    requests.some((request) => request.path === '/api/invite-link/replace'),
  ).toBe(false);
  await confirmAction('Cancel');
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await click('Link options');
  await click('Replace link');
  await confirmAction('Replace link');
  const first = pending('/api/invite-link/replace');
  const body = JSON.parse(String(first.options?.body));
  expect(body).toEqual({ id: expect.any(String), expectedId: 'existing' });
  expect(renderer.root.findByType('dialog').props['aria-busy']).toBe(true);
  expect(
    renderer.root
      .findByType('dialog')
      .findAllByType('button')
      .every((button) => button.props.disabled),
  ).toBe(true);
  await reply(first, { error: 'Please retry' }, 503);
  await reply(pending('/api/invite-link'), {
    link: { id: body.id, expiresAt, available: true },
  });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(1);
  await confirmAction('Replace link');
  expect(
    JSON.parse(String(pending('/api/invite-link/replace').options?.body)),
  ).toEqual(body);
  await reply(pending('/api/invite-link/replace'), {
    id: body.id,
    expiresAt,
    url: 'https://slowmass.com/invite#replacement',
  });
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findByProps({ id: 'invite-link-url' }).props.value).toBe(
    'https://slowmass.com/invite#replacement',
  );
  expect(visibleText()).toContain('Copy the new link to share it.');
});

it('copies the current link to the clipboard and displays its expiry', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const expiresAt = Date.now() + 604800000;
  await mount(createElement(InvitationForm));
  await reply(pending('/api/invite-link'), {
    link: { id: 'existing', expiresAt, available: true },
  });
  await reply(pending('/api/invitations?'), { items: [], next: null });
  await click('Copy invite link');
  await reply(pending('/api/invite-link/copy'), {
    id: 'existing',
    expiresAt,
    url: 'https://slowmass.com/invite#synthetic',
  });
  expect(writeText).toHaveBeenCalledWith(
    'https://slowmass.com/invite#synthetic',
  );
  expect(visibleText()).toContain('Link copied.');
  expect(renderer.root.findByType('time').props.dateTime).toBe(
    new Date(expiresAt).toISOString(),
  );
});

it('recovers a failed current-link read without creating credentials on load', async () => {
  await mount(createElement(InvitationForm));
  await reply(pending('/api/invite-link'), { error: 'Try later' }, 503);
  await reply(pending('/api/invitations?'), { items: [], next: null });
  expect(visibleText()).toContain('Try later');
  expect(
    renderer.root
      .findAllByType('button')
      .some((button) => button.children.join('') === 'Copy invite link'),
  ).toBe(false);
  await click('Retry');
  await reply(pending('/api/invite-link'), {
    link: { id: 'expired', expiresAt: 1, available: false },
  });
  expect(visibleText()).toContain('Copy to get a new seven-day link.');
  expect(
    requests.every(
      (request) => !request.options?.method || request.options.method === 'GET',
    ),
  ).toBe(true);
});

it('previews shared invitations without consuming them and requests email verification only on submit', async () => {
  location.pathname = '/invite';
  location.hash = '#' + 'a'.repeat(48);
  authMocks.magicLink.mockResolvedValue({ data: { status: true } });
  await mount(createElement(Welcome));
  expect(requests.map((request) => request.path)).toEqual([
    '/api/auth/shared-invitation/preview',
  ]);
  expect(authMocks.magicLink).not.toHaveBeenCalled();
  await reply(pending('/api/auth/shared-invitation/preview'), {
    status: 'ready',
    expiresAt: Date.now() + 100000,
    inviter: { name: 'Alice', handle: 'alice' },
    signedIn: false,
  });
  await act(async () =>
    renderer.root
      .findByProps({ id: 'shared-invite-email' })
      .props.onChange({ target: { value: 'friend@example.com' } }),
  );
  await act(async () => {
    await renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(authMocks.magicLink).toHaveBeenCalledWith(
    expect.objectContaining({
      email: 'friend@example.com',
      metadata: { inviteLink: 'a'.repeat(48) },
      callbackURL: '/',
    }),
  );
  expect(visibleText()).toContain('Check your email');
  expect(visibleText()).toContain('You can join when verification succeeds');
});

it('shows joined activity as a whole profile link with the private avatar', async () => {
  await mount(createElement(Notifications));
  await reply(pending('/api/notifications?'), {
    items: [
      {
        key: 'joined:bob',
        kind: 'joined',
        handle: 'bob',
        createdAt: 1,
        version: 1,
        unread: true,
      },
    ],
    next: null,
  });
  const row = renderer.root.findByProps({
    className: 'notification-post notification-joined',
  });
  expect(row.props.href).toBe('#profile/bob');
  expect(row.findByType('img').props.src).toBe('/media/avatar/bob');
  expect(
    row.findByProps({ 'data-notification-key': 'joined:bob' }),
  ).toBeDefined();
  expect(visibleText()).toContain('joined slowmass through your invitation');
  expect(
    renderer.root
      .findAllByType('button')
      .some((button) => button.children.includes('Accept')),
  ).toBe(false);
});

it('starts profile posts in parallel, reveals them after authorization, and does not refetch', async () => {
  await mount(createElement(ProfilePage, { handle: 'alice' }));
  const profileRequest = pending('/api/people/alice');
  const postsRequest = pending('/api/posts?handle=alice');
  await reply(postsRequest, { items: [post('parallel')], next: null });
  expect(
    renderer.root.findAllByProps({ className: 'grid-photo' }),
  ).toHaveLength(0);
  await reply(profileRequest, {
    profile: { ...ownProfile, relationship: 'self' },
  });
  expect(
    renderer.root.findAllByProps({ className: 'grid-photo' }),
  ).toHaveLength(1);
  expect(requests.filter((r) => r.path.startsWith('/api/posts'))).toHaveLength(
    1,
  );
});

it('uses authoritative like responses without a second post request and retains counts on failure', async () => {
  await mount(
    createElement(Interactions, {
      postId: 'fast',
      initial: { likeCount: 0, commentCount: 2, liked: 0 },
    }),
  );
  await click('Like photo');
  expect(requests).toHaveLength(1);
  await reply(pending('/api/interactions/fast/like'), {
    ok: true,
    likeCount: 3,
    commentCount: 2,
    liked: 1,
  });
  expect(
    renderer.root.findByProps({ 'aria-label': 'Unlike photo' }).props[
      'aria-pressed'
    ],
  ).toBe(true);
  expect(requests).toHaveLength(1);
  await click('Unlike photo');
  await reply(
    pending('/api/interactions/fast/like'),
    { error: 'Try again' },
    503,
  );
  expect(
    renderer.root.findByProps({ 'aria-label': 'Unlike photo' }).props[
      'aria-pressed'
    ],
  ).toBe(true);
  expect(visibleText()).toContain('Try again');
  expect(requests.every((r) => r.path.endsWith('/like'))).toBe(true);
});

it('opens the requested member page immediately after the required photo is saved', async () => {
  Object.assign(navigator, { userAgent: 'iPhone', standalone: false });
  await mount(
    createElement(MemberApp, {
      initialProfile: { ...ownProfile, hasAvatar: 0 },
      onSignOut: vi.fn(),
      signingOut: false,
    }),
  );
  expect(visibleText()).toContain('Add a profile photo');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
  ).toHaveLength(0);
  expect(requests.some((item) => item.path.startsWith('/api/posts'))).toBe(
    false,
  );
  await act(async () => renderer.root.findByType(AvatarForm).props.onChange());
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
  ).toHaveLength(1);
  expect(renderer.root.findAllByProps({ 'data-page': 'feed' })).toHaveLength(1);
  expect(pending('/api/posts?').path).toContain('/api/posts');
  expect(visibleText()).not.toContain('Set up this device');
  expect(visibleText()).not.toContain('Install slowmass');
  expect(
    requests.some(
      (item) =>
        item.path.startsWith('/api/push') || item.path === '/api/device-setup',
    ),
  ).toBe(false);
});

it.each([
  { userAgent: 'iPhone', standalone: false, summary: 'first add slowmass' },
  { userAgent: 'iPhone', standalone: true, summary: 'Turn on notifications' },
  { userAgent: 'Android', standalone: false, summary: 'Turn on notifications' },
  { userAgent: 'Desktop', standalone: false, summary: null },
])(
  'offers pending device setup only in Activity, without prompts or setup requests, for %j',
  async ({ summary, ...device }) => {
    Object.assign(navigator, device);
    vi.stubGlobal('PushManager', class {});
    const permission = vi.fn();
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: permission,
    });
    Object.assign(navigator, {
      serviceWorker: { getRegistration: vi.fn(async () => undefined) },
    });
    await mount(createElement(Welcome));
    await reply(pending('/api/bootstrap'), {
      ...signedIn,
      deviceSetupPending: true,
      pushSubscribed: false,
    });
    expect(renderer.root.findAllByProps({ 'data-page': 'feed' })).toHaveLength(
      1,
    );
    expect(pending('/api/posts?').path).toContain('/api/posts');
    expect(visibleText()).not.toContain('Create your profile');
    expect(visibleText()).not.toContain('Set up this device');
    expect(visibleText()).not.toContain('Turn on notifications');
    await reply(pending('/api/notifications/unread-count'), { count: 2 });
    expect(
      renderer.root.findByProps({ className: 'nav-badge' }).children,
    ).toEqual([summary ? '3' : '2']);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(
      requests.some(
        (item) =>
          item.path.startsWith('/api/push') ||
          item.path === '/api/device-setup',
      ),
    ).toBe(false);
    await go('#notifications');
    await reply(pending('/api/notifications?'), { items: [], next: null });
    if (summary) expect(visibleText()).toContain(summary);
    else expect(visibleText()).not.toContain('Turn on notifications');
    expect(permission).not.toHaveBeenCalled();
    expect(requests.some((item) => item.path === '/api/device-setup')).toBe(
      false,
    );
    await go('#settings');
    expect(visibleText()).toContain('Notifications');
    if (summary) expect(visibleText()).toContain('Install slowmass');
    expect(permission).not.toHaveBeenCalled();
  },
);

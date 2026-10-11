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
import { PostDetail, PostList } from '../src/client/features/posts/Posts';
import { Notifications } from '../src/client/features/notifications/Notifications';
import { InvitationForm } from '../src/client/features/invitations/InvitationForm';
import { Interactions } from '../src/client/features/interactions/Interactions';

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    signIn: { magicLink: vi.fn() },
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
  requests = [];
  const events = new EventTarget();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', {
    hash: '#feed',
    search: '',
    origin: 'https://slowmass.com',
  });
  vi.stubGlobal('navigator', { standalone: false });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
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
function noLogin() {
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
  expect(visibleText()).not.toContain('Welcome to Slowmass');
}
const ownProfile = {
  handle: 'alice',
  displayName: 'Alice',
  bio: 'Hello',
  hasAvatar: 0,
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
    hasAvatar: 0,
    isOwner: false,
    mediaUrl: `/media/post/${id}`,
    likeCount: 0,
    commentCount: 0,
    liked: 0,
  };
}

it('never shows login or onboarding while a returning member session and profile are loading', async () => {
  await mount(createElement(Welcome));
  expect(visibleText()).toContain('Loading Slowmass…');
  noLogin();
  await reply(pending('/api/status'), { signInAvailable: true });
  expect(visibleText()).toContain('Loading Slowmass…');
  noLogin();
  await reply(pending('/api/me'), { user: { name: 'Alice' } });
  expect(visibleText()).toContain('Loading your account…');
  expect(visibleText()).not.toContain('Create your profile');
  expect(
    renderer.root.findAllByProps({ 'aria-label': 'Main navigation' }),
  ).toHaveLength(0);
  noLogin();
  await reply(pending('/api/people/self'), { profile: ownProfile });
  expect(visibleText()).toContain('Loading posts…');
  expect(visibleText()).not.toContain('No posts');
  await reply(pending('/api/posts?'), { items: [], next: null });
  expect(visibleText()).toContain('No posts on this page.');
  noLogin();
});

it('shows the login form only after a confirmed signed-out response', async () => {
  await mount(createElement(Welcome));
  await reply(pending('/api/status'), { signInAvailable: true });
  noLogin();
  await reply(pending('/api/me'), { error: 'Sign in to continue.' }, 401);
  expect(visibleText()).toContain('Send sign-in link');
  expect(visibleText()).not.toContain('Loading Slowmass');
});

it('does not mistake session failures for signed-out state and clears the error during retry', async () => {
  await mount(createElement(Welcome));
  await reply(pending('/api/status'), { signInAvailable: true });
  await reply(pending('/api/me'), { error: 'Unavailable' }, 503);
  noLogin();
  expect(visibleText()).toContain('Check your connection');
  await click('Try again');
  expect(visibleText()).toContain('Loading Slowmass…');
  expect(visibleText()).not.toContain('Check your connection');
  await reply(pending('/api/status'), { signInAvailable: true });
  await reply(pending('/api/me'), { user: { name: 'Alice' } });
  noLogin();
  expect(visibleText()).toContain('Loading your account…');
});

it('keeps unavailable and offline startup separate from login', async () => {
  await mount(createElement(Welcome));
  const first = pending('/api/status');
  first.settled = true;
  await act(async () => {
    first.reject(new TypeError('Failed to fetch'));
  });
  noLogin();
  await click('Try again');
  await reply(pending('/api/status'), { signInAvailable: false });
  expect(visibleText()).toContain('temporarily unavailable');
  noLogin();
  expect(requests.some((item) => item.path === '/api/me')).toBe(false);
});

it('retries a failed own-profile read without flashing onboarding', async () => {
  await mount(
    createElement(MemberApp, { onSignOut: vi.fn(), signingOut: false }),
  );
  await reply(
    pending('/api/people/self'),
    { error: 'Profile read failed' },
    503,
  );
  await click('Retry');
  expect(visibleText()).toContain('Loading your account…');
  expect(visibleText()).not.toContain('Profile read failed');
  expect(visibleText()).not.toContain('Create your profile');
  await reply(pending('/api/people/self'), { profile: null });
  expect(visibleText()).toContain('Create your profile');
});

const lists = [
  {
    name: 'posts',
    element: () => createElement(PostList),
    path: '/api/posts?',
    loading: 'Loading posts…',
    empty: 'No posts on this page.',
    retry: 'Refresh posts',
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
    element: () => createElement(Connections, { kind: 'requests' }),
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
    empty: 'No notifications on this page.',
    retry: 'Retry',
  },
  {
    name: 'invitations',
    element: () => createElement(InvitationForm),
    path: '/api/invitations?',
    loading: 'Loading invitations…',
    empty: 'No invitations yet.',
    retry: 'Reload invitations',
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
    retry: 'Reload comments',
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

it('does not show an old feed page or end marker while paging and refreshing', async () => {
  await mount(createElement(PostList));
  await reply(pending('/api/posts?'), {
    items: [post('first')],
    next: 'older',
  });
  await click('Older');
  expect(visibleText()).toContain('Loading posts…');
  expect(visibleText()).not.toContain('Photo first');
  expect(visibleText()).not.toContain('End of posts.');
  await reply(pending('/api/posts?cursor=older'), { items: [], next: null });
  expect(visibleText()).toContain('End of posts.');
  await click('Refresh posts');
  expect(visibleText()).not.toContain('End of posts.');
  expect(visibleText()).not.toContain('No posts on this page.');
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
  expect(requests.some((item) => item.path.startsWith('/api/posts'))).toBe(
    false,
  );
});

it.each(['connections', 'activity'])(
  '%s stop showing an accepted follow request while refreshing',
  async (kind) => {
    await mount(
      kind === 'connections'
        ? createElement(Connections, { kind: 'requests' })
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
          unread: 1,
        },
      ],
      next: null,
    });
    await click('Accept');
    await reply(pending('/api/people/alice/accept'), { ok: true });
    expect(visibleText()).toContain('Loading');
    expect(visibleText()).not.toContain('@alice');
    expect(
      renderer.root
        .findAllByType('button')
        .some((item) => item.children.join('') === 'Accept'),
    ).toBe(false);
  },
);

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
  expect(visibleText()).toContain('Invitation ready');
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
  expect(visibleText()).not.toContain('Invitation ready');
});

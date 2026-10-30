import { createElement, act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberApp } from '../src/client/features/people/MemberApp';
import { ProfileEditor } from '../src/client/features/people/ProfileEditor';
import { PostList } from '../src/client/features/posts/Posts';
import { InstallApp } from '../src/client/features/install/InstallApp';
import { currentRoute, useRoute } from '../src/client/navigation';
vi.mock('../src/client/api', () => ({
  api: vi.fn(async (path: string) =>
    path === '/api/people/self'
      ? {
          profile: {
            handle: 'alice',
            displayName: 'Alice',
            bio: 'Bio',
            hasAvatar: 1,
          },
        }
      : path === '/api/people/alice'
        ? {
            profile: {
              handle: 'alice',
              displayName: 'Alice',
              bio: 'Bio',
              relationship: 'self',
            },
          }
        : { items: [], next: null },
  ),
  jsonRequest: vi.fn(),
}));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('opens event share paths and keeps hash navigation and Back/Forward on the right URL', async () => {
  const token = 'a'.repeat(48);
  const address = new URL(`https://slowmass.com/event/${token}`);
  const events = new EventTarget();
  vi.stubGlobal('location', address);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    scrollY: 0,
    history: {
      state: null,
      replaceState: (_state: unknown, _unused: string, path: string) => {
        address.href = new URL(path, address).href;
      },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    scrollTo: vi.fn(),
  });
  function Route() {
    const { route } = useRoute();
    return createElement('output', null, route);
  }
  await act(async () => {
    renderer = create(createElement(Route));
  });
  expect(currentRoute()).toBe(`event/${token}`);
  expect(renderer!.root.findByType('output').children).toEqual([
    `event/${token}`,
  ]);
  await act(async () => {
    address.hash = '#profile/alice';
    events.dispatchEvent(new Event('hashchange'));
  });
  expect(address.href).toBe('https://slowmass.com/#profile/alice');
  expect(renderer!.root.findByType('output').children).toEqual([
    'profile/alice',
  ]);
  await act(async () => {
    address.href = `https://slowmass.com/event/${token}`;
    events.dispatchEvent(new Event('popstate'));
  });
  expect(renderer!.root.findByType('output').children).toEqual([
    `event/${token}`,
  ]);
  await act(async () => {
    address.href = `https://slowmass.com/#event/${token}`;
    events.dispatchEvent(new Event('hashchange'));
  });
  expect(currentRoute()).toBe(`event/${token}`);
});

it('unmounts edit forms across repeated feed/profile/settings navigation without duplicate React keys', async () => {
  const events = new EventTarget();
  const location = { hash: '#edit', origin: 'https://slowmass.com' };
  vi.stubGlobal('location', location);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    scrollY: 0,
    history: { scrollRestoration: 'auto', state: null, replaceState: vi.fn() },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    scrollTo: vi.fn(),
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  vi.stubGlobal('navigator', { standalone: false });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const errors = vi.spyOn(console, 'error');
  await act(async () => {
    renderer = create(
      createElement(MemberApp, {
        initialProfile: {
          handle: 'alice',
          displayName: 'Alice',
          bio: 'Bio',
          hasAvatar: 1,
        },
        onSignOut: vi.fn(),
        signingOut: false,
      }),
    );
  });
  expect(renderer!.root.findAllByType(ProfileEditor)).toHaveLength(1);
  async function go(hash: string) {
    await act(async () => {
      location.hash = hash;
      events.dispatchEvent(new Event('hashchange'));
    });
  }
  for (let i = 0; i < 3; i++) {
    await go('#feed');
    expect(renderer!.root.findAllByType(ProfileEditor)).toHaveLength(0);
    expect(renderer!.root.findAllByType(PostList)).toHaveLength(1);
    expect(renderer!.root.findAllByType(InstallApp)).toHaveLength(0);
    await go('#profile/alice');
    expect(renderer!.root.findAllByType(PostList)[0].props.grid).toBe(true);
    expect(renderer!.root.findAllByType(ProfileEditor)).toHaveLength(0);
    await go('#settings');
    expect(renderer!.root.findAllByType(InstallApp)).toHaveLength(1);
    expect(renderer!.root.findAllByType(PostList)).toHaveLength(0);
    await go('#edit');
    expect(renderer!.root.findAllByType(ProfileEditor)).toHaveLength(1);
  }
  expect(
    errors.mock.calls.some((call) => String(call[0]).includes('same key')),
  ).toBe(false);
});

it('restores route offsets on Back/Forward and app links, ignores duplicate events, and resets on reselection', async () => {
  const address = new URL('https://slowmass.com/#feed');
  const events = new EventTarget();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('location', address);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const win = {
    scrollY: 0,
    history: { scrollRestoration: 'auto' },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    scrollTo: vi.fn(({ top }: { top: number }) => {
      win.scrollY = top;
    }),
  };
  vi.stubGlobal('window', win);
  function Route() {
    const { route, resetScroll } = useRoute();
    return createElement('button', { onClick: resetScroll }, route);
  }
  await act(async () => {
    renderer = create(createElement(Route));
  });
  expect(win.history.scrollRestoration).toBe('manual');
  async function go(hash: string, traversal = false) {
    await act(async () => {
      address.hash = hash;
      if (traversal) events.dispatchEvent(new Event('popstate'));
      events.dispatchEvent(new Event('hashchange'));
    });
  }
  win.scrollY = 1800;
  await go('#post/one');
  expect(win.scrollY).toBe(0);
  win.scrollY = 450;
  await go('#feed', true);
  expect(win.scrollY).toBe(1800);
  await go('#post/one', true);
  expect(win.scrollY).toBe(450);
  await go('#feed');
  expect(win.scrollY).toBe(1800);
  await act(async () => renderer!.root.findByType('button').props.onClick());
  expect(win.scrollY).toBe(0);
  await go('#post/one');
  expect(win.scrollY).toBe(0);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(win.history.scrollRestoration).toBe('auto');
});

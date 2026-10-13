import { createElement, act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberApp } from '../src/client/features/people/MemberApp';
import { AvatarForm } from '../src/client/features/avatars/AvatarForm';
import { ProfileForm } from '../src/client/features/people/ProfileForm';
import { PostList } from '../src/client/features/posts/Posts';
import { InstallApp } from '../src/client/features/install/InstallApp';
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
it('unmounts edit forms across repeated feed/profile/settings navigation without duplicate React keys', async () => {
  const events = new EventTarget();
  const location = { hash: '#edit', origin: 'https://slowmass.com' };
  vi.stubGlobal('location', location);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
  expect(renderer!.root.findAllByType(AvatarForm)).toHaveLength(1);
  expect(renderer!.root.findAllByType(ProfileForm)).toHaveLength(1);
  async function go(hash: string) {
    await act(async () => {
      location.hash = hash;
      events.dispatchEvent(new Event('hashchange'));
    });
  }
  for (let i = 0; i < 3; i++) {
    await go('#feed');
    expect(renderer!.root.findAllByType(AvatarForm)).toHaveLength(0);
    expect(renderer!.root.findAllByType(ProfileForm)).toHaveLength(0);
    expect(renderer!.root.findAllByType(PostList)).toHaveLength(1);
    expect(renderer!.root.findAllByType(InstallApp)).toHaveLength(0);
    await go('#profile/alice');
    expect(renderer!.root.findAllByType(PostList)[0].props.grid).toBe(true);
    expect(renderer!.root.findAllByType(AvatarForm)).toHaveLength(0);
    await go('#settings');
    expect(renderer!.root.findAllByType(InstallApp)).toHaveLength(1);
    expect(renderer!.root.findAllByType(PostList)).toHaveLength(0);
    await go('#edit');
    expect(renderer!.root.findAllByType(AvatarForm)).toHaveLength(1);
    expect(renderer!.root.findAllByType(ProfileForm)).toHaveLength(1);
  }
  expect(
    errors.mock.calls.some((call) => String(call[0]).includes('same key')),
  ).toBe(false);
});

import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockUploads } from '../../../../tests/support/upload';
import { AvatarForm } from '../avatars';
import { ProfileSetup } from './ProfileSetup';

const profile = { handle: 'erin', displayName: 'Erin', bio: '', hasAvatar: 0 };
const photo = {
  id: '11111111-2222-4333-8444-555555555555',
  blob: new Blob(['crop'], { type: 'image/webp' }),
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {});
  mockUploads((path, options) => fetch(path, options));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  const onFinish = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(ProfileSetup, {
        profile,
        eventRoute: undefined,
        startImmediately: true,
        onFinish,
      }),
    );
  });
  await act(async () =>
    renderer.root.findByType(AvatarForm).props.onSelect(photo),
  );
  return onFinish;
}
async function finish() {
  await act(async () =>
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}

it('keeps both fields after a lost upload reply and retries the same photo without duplicate submissions', async () => {
  let resolveName!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveName = resolve;
        }),
    )
    .mockRejectedValueOnce(new TypeError('Network error'))
    // A previous upload may already have committed despite the lost reply.
    .mockResolvedValueOnce(
      Response.json({ profile: { ...profile, hasAvatar: 1 } }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const onFinish = await mount();
  await finish();
  await finish();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ id: 'handle' }).props.disabled).toBe(true);
  expect(renderer.root.findByProps({ id: 'avatar-file' }).props.disabled).toBe(
    true,
  );
  await act(async () => resolveName(Response.json({ profile })));
  expect(onFinish).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('connection was interrupted');
  expect(renderer.root.findByType(AvatarForm).props.draft).toBe(photo);
  expect(renderer.root.findByProps({ id: 'handle' }).props.disabled).toBe(
    false,
  );
  await finish();
  expect(fetch).toHaveBeenCalledTimes(4);
  const first = fetch.mock.calls[1][1] as RequestInit;
  const retry = fetch.mock.calls[3][1] as RequestInit;
  expect(retry.headers).toEqual(first.headers);
  expect(retry.body).toBe(first.body);
  expect(onFinish).toHaveBeenCalledExactlyOnceWith({
    ...profile,
    hasAvatar: 1,
  });
});

it.each(['username', 'photo'])(
  'aborts navigation away during the %s save and ignores late success',
  async (stage) => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn();
    if (stage === 'photo')
      fetch.mockResolvedValueOnce(Response.json({ profile }));
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const onFinish = await mount();
    await finish();
    const pending = fetch.mock.calls.at(-1)![1] as RequestInit;
    await act(async () => renderer.unmount());
    expect(pending.signal?.aborted).toBe(true);
    await act(async () =>
      resolve(Response.json(stage === 'username' ? { profile } : { ok: true })),
    );
    expect(fetch).toHaveBeenCalledTimes(stage === 'username' ? 1 : 2);
    expect(onFinish).not.toHaveBeenCalled();
  },
);

it('releases a timed-out username save for retry without uploading or losing the photo', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => new Promise<Response>(() => {}))
    .mockResolvedValueOnce(Response.json({ profile }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const onFinish = await mount();
  await finish();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('too long to confirm');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(AvatarForm).props.draft).toBe(photo);
  expect(onFinish).not.toHaveBeenCalled();
  await finish();
  expect(onFinish).toHaveBeenCalledOnce();
});

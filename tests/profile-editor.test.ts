import { mockUploads } from './support/upload';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileEditor } from '../src/client/features/people/ProfileEditor';
import { decodePhoto, encodeCrop } from '../src/client/features/avatars/crop';

vi.mock('../src/client/features/avatars/crop', async (original) => ({
  ...(await original<object>()),
  decodePhoto: vi.fn(),
  encodeCrop: vi.fn(),
}));
let renderer: ReactTestRenderer;
const profile = {
  handle: 'alice',
  displayName: 'Alice',
  bio: 'Bio',
  hasAvatar: 1,
};
const photo = () =>
  new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {});
  vi.mocked(decodePhoto)
    .mockReset()
    .mockResolvedValue({
      width: 1200,
      height: 800,
      close: vi.fn(),
    } as unknown as ImageBitmap);
  vi.mocked(encodeCrop)
    .mockReset()
    .mockResolvedValue(new Blob(['crop'], { type: 'image/webp' }));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(
  onSaved = vi.fn(),
  onCancel = vi.fn(),
  onPhotoSaved = vi.fn(),
) {
  await act(async () => {
    renderer = create(
      createElement(ProfileEditor, {
        profile,
        onSaved,
        onPhotoSaved,
        onCancel,
      }),
    );
  });
  return { onSaved, onCancel, onPhotoSaved };
}
// Profile details go through fetch; the photo goes through the upload transport.
function details(response: () => Promise<Response>) {
  const fetch = vi.fn<
    (path: string, options?: RequestInit) => Promise<Response>
  >(() => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const saved = () =>
  Promise.resolve(Response.json({ profile: { ...profile, bio: 'New bio' } }));
async function edit(id: string, value: string) {
  await act(async () =>
    renderer.root.findByProps({ id }).props.onChange({ target: { value } }),
  );
}
async function choosePhoto(zoom?: string) {
  await act(async () =>
    renderer.root
      .findByProps({ id: 'avatar-file' })
      .props.onChange({ target: { files: [photo()], value: '' } }),
  );
  const dialog = renderer.root.findByType('dialog');
  if (zoom)
    await act(async () =>
      dialog
        .findByProps({ id: 'avatar-zoom' })
        .props.onChange({ target: { value: zoom } }),
    );
  await act(async () =>
    dialog.findByType('form').props.onSubmit({ preventDefault: vi.fn() }),
  );
}
async function save() {
  await act(async () =>
    renderer.root
      .findByProps({ className: 'profile-editor' })
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}
const alert = () =>
  renderer.root.findByProps({ role: 'alert' }).children.join('');

it('saves edited details without uploading when the photo is unchanged', async () => {
  const fetch = details(saved);
  const uploads = mockUploads();
  const { onSaved } = await mount();
  await edit('bio', 'New bio');
  await save();
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
    handle: 'alice',
    displayName: 'Alice',
    bio: 'New bio',
  });
  expect(uploads).toHaveLength(0);
  expect(onSaved).toHaveBeenCalledWith({ ...profile, bio: 'New bio' });
});

it('previews a cropped photo but uploads it only on Save, after the details', async () => {
  const fetch = details(saved);
  const uploads = mockUploads(() =>
    Promise.resolve(Response.json({ ok: true })),
  );
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:avatar');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { onSaved, onPhotoSaved } = await mount();
  expect(renderer.root.findByProps({ className: 'avatar' }).props.src).toBe(
    '/media/avatar/alice',
  );
  await choosePhoto();
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findByProps({ className: 'avatar' }).props.src).toBe(
    'blob:avatar',
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(uploads).toHaveLength(0);
  await save();
  expect(fetch).toHaveBeenCalledOnce();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].path).toBe('/api/avatar');
  expect(onPhotoSaved).toHaveBeenCalledOnce();
  expect(onSaved).toHaveBeenCalledWith({ ...profile, bio: 'New bio' });
  createUrl.mockRestore();
  revoke.mockRestore();
});

it('cancels without saving the details or the cropped photo', async () => {
  const fetch = details(saved);
  const uploads = mockUploads();
  const { onCancel, onSaved } = await mount();
  await edit('display-name', 'Alicia');
  await choosePhoto();
  await act(async () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === 'Cancel')!
      .props.onClick(),
  );
  expect(onCancel).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(uploads).toHaveLength(0);
  expect(onSaved).not.toHaveBeenCalled();
});

it('keeps usernames to one lowercase word and checks them before saving', async () => {
  const fetch = details(saved);
  await mount();
  await edit('handle', 'New Name\n');
  expect(renderer.root.findByProps({ id: 'handle' }).props.value).toBe(
    'newname',
  );
  expect(
    renderer.root.findByProps({ id: 'handle-help' }).children.join(''),
  ).toContain('changes your profile link');
  await edit('handle', 'a-b');
  await save();
  expect(alert()).toContain('3–30 letters, numbers, or underscores');
  expect(fetch).not.toHaveBeenCalled();
});

it('shows transfer and processing status, then unlocks a timed-out save for a safe retry', async () => {
  vi.useFakeTimers();
  details(saved);
  const uploads = mockUploads(
    vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(Response.json({ ok: true })),
  );
  const { onSaved } = await mount();
  await choosePhoto();
  await save();
  await act(async () => uploads[0].progress(45));
  expect(renderer.root.findByType('progress').props.value).toBe(45);
  await act(async () => uploads[0].sent());
  expect(renderer.root.findAllByType('progress')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Processing and saving');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain(
    'taking longer than usual',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(105_000);
  });
  expect(renderer.root.findByProps({ id: 'bio' }).props.disabled).toBe(false);
  expect(alert()).toContain('too long to confirm');
  expect(onSaved).not.toHaveBeenCalled();
  await save();
  expect(uploads[1].headers).toEqual(uploads[0].headers);
  expect(uploads[1].body).toBe(uploads[0].body);
  expect(onSaved).toHaveBeenCalledOnce();
});

it('retries exactly the same encoded crop and upload ID after a lost response', async () => {
  const fetch = details(saved);
  const uploads = mockUploads(
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(Response.json({ ok: true })),
  );
  const { onSaved } = await mount();
  await choosePhoto('2');
  await save();
  expect(onSaved).not.toHaveBeenCalled();
  expect(alert()).toContain(
    'The connection was interrupted. Check your connection, then retry the same photo to check whether it saved.',
  );
  await save();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
  expect(uploads[1].headers).toEqual(uploads[0].headers);
  expect(uploads[1].body).toBe(uploads[0].body);
  expect(encodeCrop).toHaveBeenCalledOnce();
  expect(encodeCrop).toHaveBeenCalledWith(expect.anything(), {
    zoom: 2,
    x: 0.5,
    y: 0.5,
  });
  expect(onSaved).toHaveBeenCalledOnce();
});

it('ignores duplicate saves and a late result after unmount', async () => {
  let finish!: (response: Response) => void;
  const fetch = details(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { onSaved } = await mount();
  await act(async () => {
    const form = renderer.root.findByProps({ className: 'profile-editor' });
    form.props.onSubmit({ preventDefault: vi.fn() });
    form.props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
  await act(async () => renderer.unmount());
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => finish(Response.json({ profile })));
  expect(onSaved).not.toHaveBeenCalled();
});

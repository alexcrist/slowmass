import { mockUploads } from './support/upload';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AvatarForm } from '../src/client/features/avatars/AvatarForm';
import { decodePhoto, encodeCrop } from '../src/client/features/avatars/crop';

vi.mock('../src/client/features/avatars/crop', async (original) => ({
  ...(await original<object>()),
  decodePhoto: vi.fn(),
  encodeCrop: vi.fn(),
}));
let renderer: ReactTestRenderer;
const bitmap = () =>
  ({ width: 1200, height: 800, close: vi.fn() }) as unknown as ImageBitmap;
const photo = () =>
  new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {});
  mockUploads((path, options) => fetch(path, options));
  vi.mocked(decodePhoto).mockReset().mockResolvedValue(bitmap());
  vi.mocked(encodeCrop)
    .mockReset()
    .mockResolvedValue(new Blob(['crop'], { type: 'image/webp' }));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows transfer and processing status, then unlocks a timed-out save for a safe retry', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => new Promise<Response>(() => {}))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const uploads = mockUploads(fetch);
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(createElement(AvatarForm, { handle: 'alice', onChange }));
  });
  await select(photo());
  await save();
  await act(async () => uploads[0].progress(45));
  expect(renderer.root.findByType('progress').props.value).toBe(45);
  await act(async () => uploads[0].sent());
  expect(renderer.root.findAllByType('progress')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Processing and saving');
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain(
    'taking longer than usual',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(105_000);
  });
  expect(renderer.root.findByProps({ id: 'avatar-zoom' }).props.disabled).toBe(
    false,
  );
  expect(
    renderer.root.findByProps({ role: 'alert' }).children.join(''),
  ).toContain('too long to confirm');
  await save();
  expect(uploads[1].headers).toEqual(uploads[0].headers);
  expect(uploads[1].body).toBe(uploads[0].body);
  expect(onChange).toHaveBeenCalledOnce();
});
async function select(file: File) {
  await act(async () =>
    renderer.root
      .findByProps({ id: 'avatar-file' })
      .props.onChange({ target: { files: [file] } }),
  );
}
async function save() {
  await act(async () =>
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}
it('retries exactly the same encoded crop and upload ID after a lost response', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Network error'))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(AvatarForm, {
        handle: 'alice',
        onChange,
      }),
    );
  });
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
  await select(photo());
  expect(renderer.root.findByType('dialog').props['aria-labelledby']).toBe(
    renderer.root.findByType('h2').props.id,
  );
  expect(fetch).not.toHaveBeenCalled();
  await act(async () =>
    renderer.root
      .findByProps({ id: 'avatar-zoom' })
      .props.onChange({ target: { value: '2' } }),
  );
  await save();
  expect(onChange).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: 'alert' }).children).toContain(
    'The connection was interrupted. Check your connection, then retry the same photo to check whether it saved.',
  );
  await save();
  expect(fetch).toHaveBeenCalledTimes(2);
  const first = fetch.mock.calls[0][1] as RequestInit;
  const retry = fetch.mock.calls[1][1] as RequestInit;
  expect(first.headers).toEqual(retry.headers);
  expect(first.body).toBe(retry.body);
  expect(encodeCrop).toHaveBeenCalledOnce();
  expect(encodeCrop).toHaveBeenCalledWith(expect.anything(), {
    zoom: 2,
    x: 0.5,
    y: 0.5,
  });
  expect(onChange).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('canvas')).toHaveLength(0);
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findAllByType('form')).toHaveLength(0);
});
it('ignores stale photo decoding and releases old images when another file is selected', async () => {
  let finishFirst!: (image: ImageBitmap) => void;
  const first = bitmap();
  const second = bitmap();
  vi.mocked(decodePhoto)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(second);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ ok: true })),
  );
  await act(async () => {
    renderer = create(
      createElement(AvatarForm, {
        handle: 'alice',
        onChange: vi.fn(),
      }),
    );
  });
  await select(photo());
  await select(photo());
  await act(async () => finishFirst(first));
  expect(first.close).toHaveBeenCalledOnce();
  await save();
  expect(encodeCrop).toHaveBeenCalledWith(second, { zoom: 1, x: 0.5, y: 0.5 });
  expect(second.close).toHaveBeenCalledOnce();
});
it('does not upload or finish onboarding if the form unmounts during encoding', async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(encodeCrop).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetch = vi.fn();
  const onChange = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await act(async () => {
    renderer = create(
      createElement(AvatarForm, {
        handle: 'alice',
        onChange,
      }),
    );
  });
  await select(photo());
  await save();
  await act(async () => renderer.unmount());
  await act(async () => finish(new Blob(['crop'])));
  expect(fetch).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
it('cancels cropping without uploading and can select the same file again', async () => {
  const image = bitmap();
  vi.mocked(decodePhoto)
    .mockResolvedValueOnce(image)
    .mockResolvedValueOnce(bitmap());
  const fetch = vi.fn();
  const onChange = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await act(async () => {
    renderer = create(createElement(AvatarForm, { handle: 'alice', onChange }));
  });
  const file = photo();
  await select(file);
  const cancel = { preventDefault: vi.fn() };
  await act(async () =>
    renderer.root.findByType('dialog').props.onCancel(cancel),
  );
  expect(cancel.preventDefault).toHaveBeenCalledOnce();
  expect(image.close).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findByType('img').props.src).toBe(
    '/media/avatar/alice?v=0',
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  await select(file);
  expect(renderer.root.findAllByType('canvas')).toHaveLength(1);
});
it('guards against duplicate crop confirmations and cancellation during saving', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const onChange = vi.fn();
  await act(async () => {
    renderer = create(createElement(AvatarForm, { handle: 'alice', onChange }));
  });
  await select(photo());
  await act(async () => {
    const form = renderer.root.findByType('form');
    form.props.onSubmit({ preventDefault: vi.fn() });
    form.props.onSubmit({ preventDefault: vi.fn() });
  });
  await act(async () =>
    renderer.root
      .findByType('dialog')
      .props.onCancel({ preventDefault: vi.fn() }),
  );
  expect(renderer.root.findAllByType('dialog')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledOnce();
  expect(encodeCrop).toHaveBeenCalledOnce();
  await act(async () => finish(Response.json({ ok: true })));
  expect(onChange).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findByType('img').props.src).toBe(
    '/media/avatar/alice?v=1',
  );
  await act(async () =>
    renderer.root
      .findByProps({ 'aria-label': "Enlarge @alice's profile photo" })
      .props.onClick(),
  );
  const dialog = renderer.root.findByType('dialog');
  expect(dialog.findByType('img').props.src).toBe(
    '/media/avatar/alice?size=large&v=1',
  );
  expect(dialog.props.className).toContain('app-dialog-image');
  await act(async () =>
    renderer.root
      .findByProps({ 'aria-label': 'Close profile photo' })
      .props.onClick(),
  );
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(fetch).toHaveBeenCalledOnce();
});

it('prepares a setup photo without uploading, keeps it when a replacement is cancelled, and releases previews', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const createUrl = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:second');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const onSelect = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(AvatarForm, { draft: null, onSelect, disabled: false }),
    );
  });
  await select(photo());
  await save();
  expect(fetch).not.toHaveBeenCalled();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect.mock.calls[0][0].blob).toBe(
    await vi.mocked(encodeCrop).mock.results[0].value,
  );
  expect(createUrl).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('img').props.src).toBe('blob:first');
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  await select(photo());
  await act(async () =>
    renderer.root
      .findByType('dialog')
      .props.onCancel({ preventDefault: vi.fn() }),
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('img').props.src).toBe('blob:first');
  await select(photo());
  await save();
  expect(onSelect.mock.calls[1][0].id).not.toBe(onSelect.mock.calls[0][0].id);
  expect(revoke).toHaveBeenCalledWith('blob:first');
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:second');
  createUrl.mockRestore();
  revoke.mockRestore();
});

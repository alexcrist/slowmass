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
const chooser = (onSelect = vi.fn()) =>
  createElement(AvatarForm, { draft: null, onSelect, disabled: false });

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
  await act(async () => {
    renderer = create(chooser());
  });
  await select(photo());
  await select(photo());
  await act(async () => finishFirst(first));
  expect(first.close).toHaveBeenCalledOnce();
  await save();
  expect(encodeCrop).toHaveBeenCalledWith(second, { zoom: 1, x: 0.5, y: 0.5 });
  expect(second.close).toHaveBeenCalledOnce();
});
it('does not select a photo if the form unmounts during encoding', async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(encodeCrop).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onSelect = vi.fn();
  await act(async () => {
    renderer = create(chooser(onSelect));
  });
  await select(photo());
  await save();
  await act(async () => renderer.unmount());
  await act(async () => finish(new Blob(['crop'])));
  expect(onSelect).not.toHaveBeenCalled();
});
it('cancels cropping without selecting and can select the same file again', async () => {
  const image = bitmap();
  vi.mocked(decodePhoto)
    .mockResolvedValueOnce(image)
    .mockResolvedValueOnce(bitmap());
  const onSelect = vi.fn();
  await act(async () => {
    renderer = create(chooser(onSelect));
  });
  const file = photo();
  await select(file);
  expect(renderer.root.findByType('dialog').props['aria-labelledby']).toBe(
    renderer.root.findByType('h2').props.id,
  );
  const cancel = { preventDefault: vi.fn() };
  await act(async () =>
    renderer.root.findByType('dialog').props.onCancel(cancel),
  );
  expect(cancel.preventDefault).toHaveBeenCalledOnce();
  expect(image.close).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
  expect(renderer.root.findAllByType('img')).toHaveLength(0);
  expect(onSelect).not.toHaveBeenCalled();
  await select(file);
  expect(renderer.root.findAllByType('canvas')).toHaveLength(1);
});
it('guards against duplicate crop confirmations and cancellation while preparing', async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(encodeCrop).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onSelect = vi.fn();
  await act(async () => {
    renderer = create(chooser(onSelect));
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
  expect(encodeCrop).toHaveBeenCalledOnce();
  await act(async () => finish(new Blob(['crop'], { type: 'image/webp' })));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
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

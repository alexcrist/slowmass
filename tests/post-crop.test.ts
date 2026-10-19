import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostCropEditor } from '../src/client/features/posts/PostCropEditor';
import { decodePhoto } from '../src/client/images/decode';
import { encodePostCrop, fullPhoto } from '../src/client/features/posts/crop';

vi.mock('../src/client/images/decode', () => ({ decodePhoto: vi.fn() }));
vi.mock('../src/client/features/posts/crop', async (original) => ({
  ...(await original<object>()),
  encodePostCrop: vi.fn(),
}));
let renderer: ReactTestRenderer;
const image = {
  width: 1200,
  height: 800,
  close: vi.fn(),
} as unknown as ImageBitmap;
const cropped = new File(['crop'], 'crop.webp', { type: 'image/webp' });
const source = new File(['original'], 'original.jpg', { type: 'image/jpeg' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {});
  vi.mocked(decodePhoto).mockReset().mockResolvedValue(image);
  vi.mocked(encodePostCrop).mockReset().mockResolvedValue(cropped);
  vi.mocked(image.close).mockClear();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
async function mount(onApply = vi.fn(), onClose = vi.fn()) {
  await act(async () => {
    renderer = create(
      createElement(PostCropEditor, {
        file: source,
        initial: fullPhoto,
        onApply,
        onClose,
      }),
      {
        createNodeMock: (element) => {
          if (element.type === 'dialog')
            return { showModal: vi.fn(), close: vi.fn() };
          if (element.type === 'canvas')
            return {
              width: 720,
              height: 480,
              getContext: () => ({ drawImage: vi.fn() }),
            };
          if (
            (element.props as { className?: string }).className ===
            'post-crop-stage'
          )
            return {
              getBoundingClientRect: () => ({ width: 400, height: 300 }),
            };
          return null;
        },
      },
    );
  });
  return { onApply, onClose };
}
const button = (label: string) =>
  renderer.root
    .findAllByType('button')
    .find(
      (node) =>
        node.props['aria-label'] === label || node.children.join('') === label,
    )!;
const click = async (label: string) =>
  act(async () => button(label).props.onClick());

it('changes aspect ratio by dragging a corner, moves with keyboard, and saves only once', async () => {
  const { onApply } = await mount();
  const pointer = (clientX: number, clientY: number) => ({
    pointerId: 1,
    button: 0,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    currentTarget: { focus: vi.fn(), setPointerCapture: vi.fn() },
  });
  await act(async () =>
    button('Resize crop from bottom right').props.onPointerDown(
      pointer(400, 300),
    ),
  );
  await act(async () =>
    button('Resize crop from bottom right').props.onPointerMove(
      pointer(200, 225),
    ),
  );
  await act(async () =>
    button('Resize crop from bottom right').props.onPointerUp(),
  );
  await act(async () =>
    button('Move crop').props.onKeyDown({
      key: 'ArrowRight',
      shiftKey: false,
      preventDefault: vi.fn(),
    }),
  );
  await act(async () =>
    button('Move crop').props.onKeyDown({
      key: 'ArrowDown',
      shiftKey: true,
      preventDefault: vi.fn(),
    }),
  );
  await act(async () => {
    const save = button('Use photo').props.onClick;
    save();
    save();
  });
  expect(encodePostCrop).toHaveBeenCalledOnce();
  expect(encodePostCrop).toHaveBeenCalledWith(image, {
    left: 0.01,
    right: 0.51,
    top: 0.1,
    bottom: 0.85,
  });
  expect(onApply).toHaveBeenCalledWith(cropped, {
    left: 0.01,
    right: 0.51,
    top: 0.1,
    bottom: 0.85,
  });
});

it('keeps the selected crop after an encoding failure and supports reset and cancel without saving', async () => {
  vi.mocked(encodePostCrop)
    .mockRejectedValueOnce(new Error('Encoding failed'))
    .mockResolvedValue(cropped);
  const { onApply, onClose } = await mount();
  await act(async () =>
    button('Resize crop from right').props.onKeyDown({
      key: 'ArrowLeft',
      shiftKey: true,
      preventDefault: vi.fn(),
    }),
  );
  await click('Use photo');
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual([
    'Encoding failed',
  ]);
  await click('Use photo');
  expect(vi.mocked(encodePostCrop).mock.calls[0][1]).toEqual(
    vi.mocked(encodePostCrop).mock.calls[1][1],
  );
  expect(onApply).toHaveBeenCalledOnce();
  await click('Reset crop');
  await click('Cancel');
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).toHaveBeenCalledOnce();
});

it('allows decoding retries and closes bitmaps without applying an encode after unmount', async () => {
  vi.mocked(decodePhoto)
    .mockRejectedValueOnce(new Error('Could not open photo'))
    .mockResolvedValue(image);
  const { onApply } = await mount();
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual([
    'Could not open photo',
  ]);
  await click('Retry');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  let finish!: (file: File) => void;
  vi.mocked(encodePostCrop).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click('Use photo');
  expect(renderer.root.findByType('dialog').props['aria-busy']).toBe(false);
  expect(button('Close crop photo').props.disabled).toBe(true);
  await act(async () => renderer.unmount());
  expect(image.close).toHaveBeenCalledOnce();
  await act(async () => finish(cropped));
  expect(onApply).not.toHaveBeenCalled();
});

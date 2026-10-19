import { mockUploads } from '../../../../tests/support/upload';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AvatarForm } from './AvatarForm';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function setup() {
  mockUploads((path, options) => fetch(path, options));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const image = { width: 1200, height: 800, close: vi.fn() };
  const context = { clearRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 640,
    height: 640,
    getContext: () => context,
    getBoundingClientRect: () => ({
      left: 20,
      top: 40,
      width: 320,
      height: 320,
    }),
    setPointerCapture: vi.fn(),
    toBlob: (callback: BlobCallback) =>
      callback(new Blob(['photo'], { type: 'image/webp' })),
  };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => image),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('document', { createElement: () => canvas });
  await act(async () => {
    renderer = create(
      createElement(AvatarForm, {
        handle: 'alice',
        onChange: vi.fn(),
      }),
      {
        createNodeMock: (element) =>
          element.type === 'canvas' ? canvas : null,
      },
    );
  });
  const choose = async () =>
    act(async () => {
      renderer!.root.findByProps({ type: 'file' }).props.onChange({
        target: {
          files: [new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' })],
          value: '',
        },
      });
    });
  await choose();
  const preview = () => renderer!.root.findByType('canvas');
  const event = (pointerId: number, x: number, y = 0.5) => ({
    pointerId,
    button: 0,
    clientX: 20 + x * 320,
    clientY: 40 + y * 320,
    currentTarget: canvas,
  });
  const rectangle = () => context.drawImage.mock.calls.at(-1)?.slice(1, 4);
  const zoom = () =>
    renderer!.root.findByProps({ id: 'avatar-zoom' }).props.value;
  return { preview, event, rectangle, zoom, choose, canvas };
}

it('handles batched pinch events, ignores extra fingers, and continues dragging after a finger lifts', async () => {
  const { preview, event, rectangle, zoom, canvas } = await setup();
  await act(async () => {
    preview().props.onPointerDown(event(1, 0.25));
    preview().props.onPointerDown(event(2, 0.75));
    preview().props.onPointerDown(event(3, 0.5));
    preview().props.onPointerMove(event(1, 0));
    preview().props.onPointerMove(event(2, 1));
    preview().props.onPointerMove(event(3, 0.8));
    preview().props.onPointerUp(event(3, 0.8));
  });
  expect(canvas.setPointerCapture.mock.calls).toEqual([[1], [2]]);
  expect(zoom()).toBeCloseTo(2);
  expect(rectangle()).toEqual([400, 200, 400]);
  await act(async () => {
    preview().props.onPointerUp(event(2, 1));
    preview().props.onLostPointerCapture(event(2, 1));
    preview().props.onPointerMove(event(1, 0.1));
  });
  expect(zoom()).toBeCloseTo(2);
  expect(rectangle()).toEqual([360, 200, 400]);
});

it.each(['onPointerCancel', 'onLostPointerCapture'])(
  'drops only the interrupted pointer on %s and clears old gestures on a new photo',
  async (end) => {
    const { preview, event, rectangle, choose, zoom } = await setup();
    await act(async () => {
      preview().props.onPointerDown(event(1, 0.25));
      preview().props.onPointerDown(event(2, 0.75));
      preview().props[end](event(2, 0.75));
      preview().props.onPointerMove(event(2, 1));
      preview().props.onPointerMove(event(1, 0.35));
    });
    expect(zoom()).toBe(1);
    expect(rectangle()).toEqual([120, 0, 800]);
    await choose();
    await act(async () => preview().props.onPointerMove(event(1, 0.5)));
    expect(rectangle()).toEqual([200, 0, 800]);
  },
);

it('retains keyboard and slider controls and prevents crop changes during upload', async () => {
  const { preview, event, rectangle, zoom } = await setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  await act(async () =>
    renderer!.root
      .findByProps({ id: 'avatar-zoom' })
      .props.onChange({ target: { value: '2' } }),
  );
  await act(async () =>
    preview().props.onKeyDown({
      key: 'ArrowRight',
      shiftKey: false,
      preventDefault: vi.fn(),
    }),
  );
  expect(rectangle()).toEqual([390, 200, 400]);
  await act(async () => {
    renderer!.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() });
    preview().props.onPointerDown(event(1, 0.25));
    preview().props.onPointerDown(event(2, 0.75));
    preview().props.onPointerMove(event(2, 1));
  });
  expect(renderer!.root.findByProps({ id: 'avatar-zoom' }).props.disabled).toBe(
    true,
  );
  expect(zoom()).toBe(2);
  expect(rectangle()).toEqual([390, 200, 400]);
});

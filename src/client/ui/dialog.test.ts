import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
afterEach(() => vi.unstubAllGlobals());
it('uses a native modal, blocks dismissal while saving, and restores scrolling and focus on close', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const trigger = { isConnected: true, focus: vi.fn() };
  const style = { overflow: 'auto' };
  vi.stubGlobal('document', { activeElement: trigger, body: { style } });
  const node = { showModal: vi.fn(), close: vi.fn() };
  const onClose = vi.fn();
  let renderer!: ReturnType<typeof create>;
  const element = (busy: boolean) =>
    createElement(Dialog, {
      title: 'Test',
      busy,
      onClose,
      children: 'Contents',
    });
  await act(async () => {
    renderer = create(element(true), {
      createNodeMock: (element) => (element.type === 'dialog' ? node : null),
    });
  });
  expect(node.showModal).toHaveBeenCalledOnce();
  expect(style.overflow).toBe('hidden');
  const cancel = { preventDefault: vi.fn() };
  await act(async () =>
    renderer.root.findByType('dialog').props.onCancel(cancel),
  );
  expect(cancel.preventDefault).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => renderer.update(element(false)));
  expect(node.showModal).toHaveBeenCalledOnce();
  await act(async () =>
    renderer.root.findByType('dialog').props.onCancel(cancel),
  );
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => renderer.unmount());
  expect(node.close).toHaveBeenCalledOnce();
  expect(style.overflow).toBe('auto');
  expect(trigger.focus).toHaveBeenCalledOnce();
});

it.each(['panel', 'image'] as const)(
  'dismisses only a complete backdrop click, not content, padding, drags, cancelled gestures, or busy saves (%s)',
  async (appearance) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('document', {});
    const onClose = vi.fn();
    const target = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 100,
        right: 400,
        bottom: 400,
      }),
    };
    let renderer!: ReturnType<typeof create>;
    const element = (busy = false) =>
      createElement(Dialog, {
        title: 'Test',
        onClose,
        busy,
        appearance,
        children: 'Contents',
      });
    await act(async () => {
      renderer = create(element());
    });
    const event = (x: number, y: number, child = false) => ({
      target: child ? {} : target,
      currentTarget: target,
      clientX: x,
      clientY: y,
      button: 0,
    });
    async function press(
      start: ReturnType<typeof event>,
      end = start,
      cancel = false,
    ) {
      await act(async () => {
        const dialog = renderer.root.findByType('dialog');
        dialog.props.onPointerDown(start);
        if (cancel) dialog.props.onPointerCancel();
        dialog.props.onClick(end);
      });
    }
    await press(event(120, 120)); // Padding is inside the dialog.
    await press(event(120, 120, true));
    await press(event(120, 120, true), event(20, 20)); // Drag from crop/content.
    await press(event(20, 20), event(120, 120));
    await press(event(20, 20), event(20, 20), true);
    expect(onClose).not.toHaveBeenCalled();
    await press(event(20, 20));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer.update(element(true)));
    await press(event(20, 20));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer.unmount());
  },
);

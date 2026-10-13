import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { OverflowMenu } from './OverflowMenu';
afterEach(() => vi.unstubAllGlobals());

it('navigates arbitrary menu items with keys, restores trigger focus, and dismisses outside', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Map<string, (event: unknown) => void>();
  const doc = {
    activeElement: null as object | null,
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal('document', doc);
  const nodes = new Map<string, { focus: () => void }>();
  const onSelect = vi.fn();
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(OverflowMenu, {
        label: 'Options',
        items: ['First', 'Second', 'Third'].map((label) => ({
          label,
          onSelect,
        })),
      }),
      {
        createNodeMock: (element) => {
          const props = element.props as {
            className?: string;
            'aria-label'?: string;
            children?: unknown;
          };
          if (element.type === 'button') {
            const name = props['aria-label'] || String(props.children);
            const node = {
              focus: () => {
                doc.activeElement = node;
              },
            };
            nodes.set(name, node);
            return node;
          }
          if (props.className === 'overflow-menu-container')
            return { contains: (target: string) => target === 'inside' };
          return null;
        },
      },
    );
  });
  const key = async (key: string, trigger = false) =>
    act(async () => {
      const element = trigger
        ? renderer.root.findByType('button')
        : renderer.root.findByProps({ role: 'menu' });
      element.props.onKeyDown({ key, preventDefault: vi.fn() });
    });
  await key('ArrowUp', true);
  expect(doc.activeElement).toBe(nodes.get('Third'));
  await key('ArrowUp');
  expect(doc.activeElement).toBe(nodes.get('Second'));
  await key('Home');
  expect(doc.activeElement).toBe(nodes.get('First'));
  await key('ArrowUp');
  expect(doc.activeElement).toBe(nodes.get('Third'));
  await key('Escape');
  expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
  expect(doc.activeElement).toBe(nodes.get('Options'));
  await key('ArrowDown', true);
  await act(async () =>
    renderer.root.findAllByProps({ role: 'menuitem' })[0].props.onClick(),
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(doc.activeElement).toBe(nodes.get('Options'));
  await key('ArrowDown', true);
  await act(async () => listeners.get('pointerdown')!({ target: 'inside' }));
  expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
  await act(async () => listeners.get('pointerdown')!({ target: 'outside' }));
  expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
  expect(listeners.has('pointerdown')).toBe(false);
  await act(async () => renderer.unmount());
});

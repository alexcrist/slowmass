import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { OverflowMenu } from './OverflowMenu';

afterEach(() => vi.unstubAllGlobals());

function eventTarget() {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    addEventListener: vi.fn(
      (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
    ),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    fire: async (name: string, target: unknown) =>
      act(async () => {
        listeners.get(name)?.({ target });
      }),
  };
}

async function setup(
  options: {
    bottom?: number;
    navTop?: number;
    mobile?: boolean;
    panelHeight?: number;
    viewportTop?: number;
  } = {},
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const doc = {
    ...eventTarget(),
    activeElement: null as object | null,
    documentElement: { clientWidth: 390 },
    querySelector: () =>
      options.navTop === undefined
        ? null
        : { getBoundingClientRect: () => ({ top: options.navTop }) },
  };
  const viewport = {
    ...eventTarget(),
    offsetLeft: 0,
    offsetTop: options.viewportTop ?? 0,
    width: 390,
    height: 800,
  };
  const win = {
    ...eventTarget(),
    innerHeight: 800,
    visualViewport: viewport,
    matchMedia: () => ({ matches: options.mobile ?? true }),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const nodes = new Map<
    string,
    {
      focus: ReturnType<typeof vi.fn>;
      offsetTop: number;
      offsetHeight: number;
      disabled: boolean;
      getBoundingClientRect: () => typeof rectangle;
    }
  >();
  const bottom = options.bottom ?? 200;
  const rectangle = {
    left: 330,
    right: 374,
    top: bottom - 44,
    bottom,
    width: 44,
    height: 44,
  };
  const panel = {
    style: {} as Record<string, string>,
    scrollTop: 0,
    clientHeight: options.panelHeight ?? 142,
    contains: (target: unknown) =>
      target === panel ||
      [...nodes].some(([name, node]) => name !== 'Options' && target === node),
    getBoundingClientRect: () => ({ width: 168, height: 142 }),
  };
  const container = {
    contains: (target: unknown) =>
      target === nodes.get('Options') || panel.contains(target),
    getBoundingClientRect: () => rectangle,
  };
  const onSelect = vi.fn();
  let props = {
    label: 'Options',
    disabled: false,
    items: ['First', 'Second', 'Third'].map((label) => ({ label, onSelect })),
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(OverflowMenu, props), {
      createNodeMock: (element) => {
        const attributes = element.props as {
          className?: string;
          'aria-label'?: string;
          children?: unknown;
          disabled?: boolean;
        };
        if (element.type === 'button') {
          const name = attributes['aria-label'] || String(attributes.children);
          const node = {
            focus: vi.fn(() => {
              doc.activeElement = node;
            }),
            offsetTop:
              4 +
              Math.max(
                0,
                props.items.findIndex((item) => item.label === name),
              ) *
                44,
            offsetHeight: 44,
            disabled: Boolean(attributes.disabled),
            getBoundingClientRect: () => rectangle,
          };
          nodes.set(name, node);
          return node;
        }
        if (attributes.className === 'overflow-menu-container')
          return container;
        if (attributes.className === 'overflow-menu') return panel;
        return null;
      },
    });
  });
  const key = async (key: string, trigger = false) => {
    const preventDefault = vi.fn();
    await act(async () => {
      const element = trigger
        ? renderer.root.findByProps({ 'aria-label': 'Options', type: 'button' })
        : renderer.root.findByProps({ role: 'menu' });
      element.props.onKeyDown({ key, preventDefault });
    });
    return preventDefault;
  };
  return {
    doc,
    win,
    viewport,
    nodes,
    panel,
    renderer,
    key,
    onSelect,
    isOpen: () => renderer.root.findAllByProps({ role: 'menu' }).length === 1,
    update: async (change: Partial<typeof props>) =>
      act(async () => {
        props = { ...props, ...change };
        renderer.update(createElement(OverflowMenu, props));
      }),
    unmount: async () => act(async () => renderer.unmount()),
  };
}

it('navigates menu items, dismisses with Escape/Tab, and restores focus before selection', async () => {
  const menu = await setup();
  await menu.key('ArrowUp', true);
  expect(menu.doc.activeElement).toBe(menu.nodes.get('Third'));
  await menu.key('ArrowUp');
  expect(menu.doc.activeElement).toBe(menu.nodes.get('Second'));
  await menu.key('Home');
  expect(menu.doc.activeElement).toBe(menu.nodes.get('First'));
  await menu.key('ArrowUp');
  expect(menu.doc.activeElement).toBe(menu.nodes.get('Third'));
  await menu.key('ArrowDown');
  expect(menu.doc.activeElement).toBe(menu.nodes.get('First'));
  await menu.key('End');
  expect(menu.doc.activeElement).toBe(menu.nodes.get('Third'));
  expect(await menu.key('Escape')).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(false);
  expect(menu.doc.activeElement).toBe(menu.nodes.get('Options'));
  await menu.key('ArrowDown', true);
  expect(await menu.key('Tab')).not.toHaveBeenCalled();
  expect(menu.isOpen()).toBe(false);
  await menu.key('ArrowDown', true);
  menu.onSelect.mockImplementation(() =>
    expect(menu.doc.activeElement).toBe(menu.nodes.get('Options')),
  );
  await act(async () =>
    menu.renderer.root.findAllByProps({ role: 'menuitem' })[0].props.onClick(),
  );
  expect(menu.onSelect).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(false);
  await menu.unmount();
});

it.each(['pointerdown', 'focusin'])(
  'dismisses on outside %s without stealing focus',
  async (event) => {
    const menu = await setup();
    await menu.key('ArrowDown', true);
    await menu.doc.fire(event, menu.nodes.get('Second'));
    expect(menu.isOpen()).toBe(true);
    const outside = {};
    menu.doc.activeElement = outside;
    await menu.doc.fire(event, outside);
    expect(menu.isOpen()).toBe(false);
    expect(menu.doc.activeElement).toBe(outside);
    expect(menu.doc.listeners.size).toBe(0);
    await menu.unmount();
  },
);

it.each(['scroll', 'resize', 'hashchange'])(
  'dismisses on %s without scrolling the opener into view',
  async (event) => {
    const menu = await setup();
    await menu.key('ArrowDown', true);
    await menu.win.fire(event, menu.doc);
    expect(menu.isOpen()).toBe(false);
    expect(menu.nodes.get('Options')?.focus).toHaveBeenLastCalledWith({
      preventScroll: true,
    });
    expect(menu.win.removeEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      true,
    );
    expect(menu.viewport.listeners.size).toBe(0);
    await menu.unmount();
  },
);

it('captures nested scrolling but keeps internal menu scrolling and keyboard movement usable', async () => {
  const menu = await setup({ panelHeight: 60 });
  await menu.key('ArrowUp', true);
  expect(menu.panel.scrollTop).toBe(76);
  expect(menu.win.addEventListener).toHaveBeenCalledWith(
    'scroll',
    expect.any(Function),
    true,
  );
  await menu.win.fire('scroll', menu.panel);
  expect(menu.isOpen()).toBe(true);
  await menu.key('Home');
  expect(menu.panel.scrollTop).toBe(4);
  await menu.win.fire('scroll', {});
  expect(menu.isOpen()).toBe(false);
  await menu.unmount();
});

it.each(['resize', 'scroll'])(
  'dismisses when the visual viewport emits %s',
  async (event) => {
    const menu = await setup();
    await menu.key('ArrowDown', true);
    await menu.viewport.fire(event, menu.viewport);
    expect(menu.isOpen()).toBe(false);
    await menu.unmount();
  },
);

it('closes immediately when disabled and does not reopen when reenabled', async () => {
  const menu = await setup();
  await menu.key('ArrowDown', true);
  await menu.update({ disabled: true });
  expect(menu.isOpen()).toBe(false);
  expect(menu.renderer.root.findByType('button').props.disabled).toBe(true);
  await menu.update({ disabled: false });
  expect(menu.isOpen()).toBe(false);
  expect(menu.onSelect).not.toHaveBeenCalled();
  await menu.unmount();
});

it('keeps equivalent choices open with fresh callbacks, but closes on changed or removed choices', async () => {
  const menu = await setup();
  await menu.key('ArrowDown', true);
  const latest = vi.fn();
  const items = ['First', 'Second', 'Third'].map((label) => ({
    label,
    onSelect: latest,
  }));
  await menu.update({ items });
  expect(menu.isOpen()).toBe(true);
  await act(async () =>
    menu.renderer.root.findAllByProps({ role: 'menuitem' })[0].props.onClick(),
  );
  expect(latest).toHaveBeenCalledOnce();
  expect(menu.onSelect).not.toHaveBeenCalled();
  await menu.key('ArrowDown', true);
  await menu.update({ items: items.slice(1) });
  expect(menu.isOpen()).toBe(false);
  await menu.key('ArrowDown', true);
  await menu.update({ items: [] });
  expect(menu.isOpen()).toBe(false);
  expect(menu.renderer.root.findByType('button').props.disabled).toBe(true);
  await menu.unmount();
});

it('positions above the measured mobile navigation and cleans up on unmount', async () => {
  const menu = await setup({ bottom: 650, navTop: 720 });
  await menu.key('ArrowDown', true);
  expect(menu.panel.style).toMatchObject({
    left: '-124px',
    top: '-146px',
    maxWidth: '374px',
    maxHeight: '594px',
  });
  await menu.unmount();
  expect(menu.doc.listeners.size).toBe(0);
  expect(menu.win.listeners.size).toBe(0);
  expect(menu.viewport.listeners.size).toBe(0);
});

it('does not treat the desktop sidebar as a bottom obstruction', async () => {
  const menu = await setup({ mobile: false, navTop: 0 });
  await menu.key('ArrowDown', true);
  expect(menu.panel.style.top).toBe('48px');
  await menu.unmount();
});

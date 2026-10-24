import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { ViewerProvider, type Viewer } from './Viewer';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function render(viewer: Viewer | null, value: string, busy = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const composer = createElement(Composer, {
    label: 'Add a comment',
    placeholder: 'Add a comment…',
    maxLength: 1000,
    value,
    busy,
    canSubmit: true,
    submitLabel: 'Post comment',
    pendingLabel: 'Posting comment',
    onChange: () => {},
    onSubmit: () => {},
  });
  if (renderer) await act(async () => renderer?.unmount());
  await act(async () => {
    renderer = create(
      viewer
        ? createElement(ViewerProvider, { value: viewer }, composer)
        : composer,
    );
  });
  return renderer!.root;
}

it('shows the viewer’s photo, or their initial before they add one', async () => {
  let root = await render(
    { displayName: 'Erin', avatar: '/media/avatar/erin?v=0' },
    '',
  );
  expect(root.findByType('img').props).toMatchObject({
    src: '/media/avatar/erin?v=0',
    alt: '',
  });
  root = await render({ displayName: ' erin', avatar: null }, '');
  expect(root.findAllByType('img')).toHaveLength(0);
  expect(root.findByProps({ className: 'composer-avatar' }).children).toEqual([
    'E',
  ]);
  root = await render(null, '');
  expect(root.findAllByProps({ className: 'composer-avatar' })).toHaveLength(0);
});

it('enables Post only for a non-blank draft that is not pending', async () => {
  const viewer = { displayName: 'Erin', avatar: null };
  const post = async (value: string, busy?: boolean) =>
    (await render(viewer, value, busy)).findByProps({ type: 'submit' }).props;
  expect((await post('   \n')).disabled).toBe(true);
  expect((await post('Tiny paws')).disabled).toBe(false);
  expect(await post('Tiny paws', true)).toMatchObject({
    disabled: true,
    'aria-label': 'Posting comment',
  });
});

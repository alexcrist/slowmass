import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationSettings } from '../src/client/features/notifications/NotificationSettings';
import { Unsubscribe } from '../src/client/features/notifications/Unsubscribe';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/client/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/api')>()),
  api: mock.api,
}));
// The device section has its own tests; keep browser push APIs out of these.
vi.mock('../src/client/features/push', () => ({
  PushDevice: () => createElement('p', null, 'Device push status'),
}));

let renderer: ReactTestRenderer;
const defaults = [
  { category: 'request', push: true, email: false },
  { category: 'likes', push: false, email: false },
  { category: 'update_blast', push: true, email: true },
];
type Pending = {
  path: string;
  options?: RequestInit;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
let pending: Pending[];
beforeEach(() => {
  pending = [];
  mock.api
    .mockReset()
    .mockImplementation(
      (path: string, options?: RequestInit) =>
        new Promise((resolve, reject) =>
          pending.push({ path, options, resolve, reject }),
        ),
    );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => {
    renderer = create(element);
  });
}
async function reply(index: number, value: unknown, error?: Error) {
  await act(async () => {
    if (error) pending[index].reject(error);
    else pending[index].resolve(value);
  });
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
function checkbox(label: string) {
  return renderer.root.find(
    (node) => node.type === 'input' && node.props['aria-label'] === label,
  );
}
async function toggle(label: string) {
  await act(async () =>
    checkbox(label).props.onChange({
      target: { checked: !checkbox(label).props.checked },
    }),
  );
}

it('shows device status and each category with its saved choices', async () => {
  await mount(createElement(NotificationSettings));
  expect(text()).toContain('Device push status');
  expect(text()).toContain('Loading notification settings');
  expect(pending[0].path).toBe('/api/notifications/preferences');
  await reply(0, { preferences: defaults });
  expect(checkbox('Push: Follow requests').props.checked).toBe(true);
  expect(checkbox('Email: Follow requests').props.checked).toBe(false);
  expect(checkbox('Push: Likes on your photos').props.checked).toBe(false);
  expect(checkbox('Email: Update blasts from hosts').props.checked).toBe(true);
  // Categories the server didn't return (an older server) aren't shown.
  expect(text()).not.toContain('Comments on your photos');
  expect(text()).toContain('Notification types');
  // Each group heads its categories, in Settings order.
  const headings = renderer.root
    .findAll((node) => node.type === 'th' && node.props.scope === 'rowgroup')
    .map((node) => node.children.join(''));
  expect(headings).toEqual(['People', 'Photos', 'Events']);
  const rows = renderer.root
    .findAllByType('tbody')
    .map((group) =>
      group
        .findAll((node) => node.type === 'th' && node.props.scope === 'row')
        .map((node) => node.children.join('')),
    );
  expect(rows).toEqual([
    ['Follow requests'],
    ['Likes on your photos'],
    ['Update blasts from hosts'],
  ]);
});

it('omits a group when the server returns none of its categories', async () => {
  await mount(createElement(NotificationSettings));
  await reply(0, { preferences: [defaults[0]] });
  expect(
    renderer.root
      .findAll((node) => node.type === 'th' && node.props.scope === 'rowgroup')
      .map((node) => node.children.join('')),
  ).toEqual(['People']);
});

it('saves one choice at a time and keeps the saved state when a save fails', async () => {
  await mount(createElement(NotificationSettings));
  await reply(0, { preferences: defaults });
  await toggle('Email: Follow requests');
  expect(JSON.parse(String(pending[1].options?.body))).toEqual({
    category: 'request',
    push: true,
    email: true,
  });
  expect(pending[1].options?.method).toBe('PUT');
  // Every choice is locked while one saves, so saves cannot race.
  expect(checkbox('Push: Likes on your photos').props.disabled).toBe(true);
  await toggle('Push: Likes on your photos');
  expect(pending).toHaveLength(2);
  await reply(1, {
    preference: { category: 'request', push: true, email: true },
  });
  expect(checkbox('Email: Follow requests').props.checked).toBe(true);
  expect(checkbox('Push: Likes on your photos').props.disabled).toBe(false);

  await toggle('Push: Likes on your photos');
  await reply(2, null, new Error('Connection interrupted.'));
  expect(text()).toContain('Connection interrupted.');
  expect(checkbox('Push: Likes on your photos').props.checked).toBe(false);
});

it('offers retry when settings fail to load', async () => {
  await mount(createElement(NotificationSettings));
  await reply(0, null, new Error('Could not load.'));
  expect(text()).toContain('Could not load.');
  await act(async () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === 'Retry')!
      .props.onClick(),
  );
  expect(pending).toHaveLength(2);
});

it('unsubscribes only after confirmation and names the category', async () => {
  const token = `alice.comment.${'a'.repeat(43)}`;
  await mount(createElement(Unsubscribe, { token }));
  // Opening the link (as mail scanners do) changes nothing.
  expect(pending).toHaveLength(0);
  expect(text()).toContain('comments on your photos');
  const button = () =>
    renderer.root
      .findAllByType('button')
      .find((button) => button.props.className === 'primary-button')!;
  await act(async () => button().props.onClick());
  await act(async () => button().props.onClick());
  expect(pending).toHaveLength(1);
  expect(pending[0].path).toBe('/api/unsubscribe');
  expect(JSON.parse(String(pending[0].options?.body))).toEqual({ token });
  await reply(0, null, new Error('This unsubscribe link isn’t valid.'));
  expect(text()).toContain('This unsubscribe link isn’t valid.');
  await act(async () => button().props.onClick());
  await reply(1, { category: 'comment' });
  expect(text()).toContain('Unsubscribed');
  expect(text()).toContain('You won’t get emails about');
  expect(text()).toContain('comments on your photos');
});

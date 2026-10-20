import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Compose } from '../src/client/features/posts/Posts';
import { PostCropEditor } from '../src/client/features/posts/PostCropEditor';
import { fullPhoto } from '../src/client/features/posts/crop';
import { EventForm } from '../src/client/features/events/EventForm';
import { mockUploads } from './support/upload';

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', {});
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })),
  );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(kind: 'post' | 'event', saved = vi.fn()) {
  await act(async () => {
    renderer = create(
      kind === 'post'
        ? createElement(Compose, { onPublished: saved })
        : createElement(EventForm, {
            hosts: [],
            onSaved: saved,
            onCancel: vi.fn(),
          }),
    );
  });
  if (kind === 'event') {
    await act(async () =>
      renderer.root
        .findByProps({ className: 'event-when-button event-editable' })
        .props.onClick(),
    );
    for (const [id, value] of [
      ['event-title', 'Dinner'],
      ['event-date', '2030-01-01'],
      ['event-start', '18:00'],
    ])
      await act(async () =>
        renderer.root.findByProps({ id }).props.onChange({ target: { value } }),
      );
  }
  const file = new File(['photo'], 'photo.webp', { type: 'image/webp' });
  await act(async () =>
    renderer.root
      .findByProps({ type: 'file' })
      .props.onChange({ target: { files: [file], value: '' } }),
  );
  await act(async () =>
    renderer.root.findByType(PostCropEditor).props.onApply(file, fullPhoto),
  );
  return saved;
}
async function submit() {
  await act(async () =>
    renderer.root
      .findByType('form')
      .props.onSubmit({ preventDefault: vi.fn() }),
  );
}
const text = () => JSON.stringify(renderer.toJSON());

it.each(['post', 'event'] as const)(
  'shows real upload phases for a %s and waits for confirmation',
  async (kind) => {
    let acknowledge!: (value: Response) => void;
    const uploads = mockUploads(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ state: 'pending' })),
    );
    const saved = await mount(kind);
    await submit();
    await submit();
    expect(uploads).toHaveLength(1);
    expect(text()).toContain('Uploading photo');
    await act(async () => uploads[0].progress(60));
    expect(renderer.root.findByType('progress').props.value).toBe(60);
    await act(async () => uploads[0].sent());
    expect(text()).toContain('Processing and saving');
    expect(saved).not.toHaveBeenCalled();
    await act(async () => acknowledge(Response.json({ ok: true })));
    expect(saved).toHaveBeenCalledOnce();
  },
);

it('keeps the post ID after unconfirmed cancellation and offers cancellation again', async () => {
  vi.useFakeTimers();
  const uploads = mockUploads();
  const fetch = vi.fn((path: string, options?: RequestInit) =>
    options?.method === 'DELETE'
      ? new Promise<Response>(() => {})
      : Promise.resolve(Response.json({ state: 'pending' })),
  );
  vi.stubGlobal('fetch', fetch);
  await mount('post');
  await submit();
  const cancel = () =>
    renderer.root
      .findAllByType('button')
      .find((node) => node.children.join('') === 'Cancel upload')!;
  await act(async () => cancel().props.onClick());
  expect(text()).toContain('Cancelling upload');
  expect(uploads[0].controller.signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(text()).toContain('Cancellation could not be confirmed');
  expect(cancel().props.disabled).toBe(false);
  expect(renderer.root.findByProps({ id: 'caption' }).props.disabled).toBe(
    true,
  );
  await submit();
  const drafts = fetch.mock.calls.filter(
    ([, options]) => options?.method === 'POST',
  );
  expect(drafts).toHaveLength(2);
  expect(drafts[0][1]?.body).toBe(drafts[1][1]?.body);
});

it('aborts an event upload on unmount and ignores its late success', async () => {
  let finish!: (value: Response) => void;
  const uploads = mockUploads(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ state: 'pending' })),
  );
  const saved = await mount('event');
  await submit();
  await act(async () => renderer.unmount());
  expect(uploads[0].controller.signal.aborted).toBe(true);
  await act(async () => finish(Response.json({ ok: true })));
  expect(saved).not.toHaveBeenCalled();
});

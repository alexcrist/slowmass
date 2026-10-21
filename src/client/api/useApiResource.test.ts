import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './index';
import { useApiResource } from './useApiResource';

vi.mock('./index', () => ({ api: vi.fn() }));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('uses a fresh admission response once, then reauthorizes refreshes and changed paths', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resource!: ReturnType<typeof useApiResource<{ title: string }>>;
  function Page({ path }: { path: string }) {
    resource = useApiResource(path, { title: 'Admitted event' });
    return createElement('p', null, resource.data?.title ?? resource.error);
  }
  const page = (path: string) =>
    createElement(StrictMode, null, createElement(Page, { path }));
  await act(async () => {
    renderer = create(page('/event/one'));
  });
  expect(api).not.toHaveBeenCalled();
  expect(resource.data?.title).toBe('Admitted event');
  vi.mocked(api).mockResolvedValueOnce({ title: 'Updated event' });
  await act(async () => resource.refresh());
  expect(api).toHaveBeenCalledTimes(1);
  expect(resource.data?.title).toBe('Updated event');
  vi.mocked(api).mockRejectedValueOnce(new Error('Event not found.'));
  await act(async () => resource.reload());
  expect(resource.data).toBeNull();
  expect(resource.error).toBe('Event not found.');
  vi.mocked(api).mockResolvedValue({ title: 'Fresh read' });
  await act(async () => renderer?.update(page('/event/two')));
  expect(resource.data?.title).toBe('Fresh read');
  await act(async () => renderer?.update(page('/event/one')));
  expect(api).toHaveBeenCalledTimes(4);
  expect(resource.data?.title).toBe('Fresh read');
});

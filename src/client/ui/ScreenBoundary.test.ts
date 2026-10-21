import { act, createElement, lazy } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenBoundary } from './ScreenBoundary';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('offers explicit reload after a failed chunk without automatically discarding drafts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const Screen = lazy(
    () =>
      new Promise<never>((_, failure) => {
        reject = failure;
      }),
  );
  await act(async () => {
    renderer = create(
      createElement(ScreenBoundary, null, createElement(Screen)),
    );
  });
  expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual([
    'Loading screen…',
  ]);
  await act(async () => reject(new Error('Chunk unavailable')));
  expect(renderer!.root.findByProps({ role: 'alert' })).toBeDefined();
  expect(reload).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findByType('button').props.onClick());
  expect(reload).toHaveBeenCalledOnce();
});

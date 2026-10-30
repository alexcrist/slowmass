import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Interactions } from './Interactions';
import { revealCommentComposer } from './comment-scroll';

let loading = true;
vi.mock('../../api/useApiResource', () => ({
  useApiResource: () => ({
    data: loading ? null : { items: [], next: null },
    loading,
    error: '',
  }),
}));
vi.mock('./comment-scroll', () => ({ revealCommentComposer: vi.fn() }));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('reveals once after a button opening settles, but not for initial expansion or refreshes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const props = {
    postId: 'synthetic-post',
    initial: { likeCount: 0, commentCount: 0, liked: 0 },
    commentsInitiallyOpen: true,
  };
  const render = () => createElement(Interactions, { ...props });
  await act(async () => {
    renderer = create(render(), {
      createNodeMock: (element) =>
        typeof element.props === 'object' &&
        element.props !== null &&
        'className' in element.props &&
        element.props.className === 'comments'
          ? { querySelector: () => ({}) }
          : {},
    });
  });
  loading = false;
  await act(async () => renderer.update(render()));
  expect(revealCommentComposer).not.toHaveBeenCalled();
  const toggle = () =>
    renderer.root
      .findByProps({ className: 'icon-button comment-toggle' })
      .props.onClick();
  await act(async () => toggle());
  loading = true;
  await act(async () => toggle());
  expect(revealCommentComposer).not.toHaveBeenCalled();
  loading = false;
  await act(async () => renderer.update(render()));
  expect(revealCommentComposer).toHaveBeenCalledTimes(1);
  loading = true;
  await act(async () => renderer.update(render()));
  loading = false;
  await act(async () => renderer.update(render()));
  expect(revealCommentComposer).toHaveBeenCalledTimes(1);
  await act(async () => toggle());
  await act(async () => toggle());
  expect(revealCommentComposer).toHaveBeenCalledTimes(2);
});

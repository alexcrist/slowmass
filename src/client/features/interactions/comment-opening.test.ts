import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Interactions } from './Interactions';
import { revealCommentComposer } from './comment-scroll';

const reads = vi.hoisted(
  () => [] as { path: string; resolve: (page: unknown) => void }[],
);
vi.mock('../../api', () => ({
  api: (path: string) =>
    new Promise((resolve) => reads.push({ path, resolve })),
  jsonRequest: () => ({}),
}));
async function reply(next: string | null) {
  const read = reads.shift();
  expect(read).toBeDefined();
  await act(async () => read!.resolve({ items: [], next }));
}
vi.mock('./comment-scroll', () => ({ revealCommentComposer: vi.fn() }));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  reads.length = 0;
});
it('reveals once after a button opening settles, but not for initial expansion or Show more', async () => {
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
  await reply(null);
  expect(revealCommentComposer).not.toHaveBeenCalled();
  const toggle = () =>
    renderer.root
      .findByProps({ className: 'icon-button comment-toggle' })
      .props.onClick();
  await act(async () => toggle());
  await act(async () => toggle());
  expect(revealCommentComposer).not.toHaveBeenCalled();
  await reply('older');
  expect(revealCommentComposer).toHaveBeenCalledTimes(1);
  // Show more appends without measuring again.
  await act(async () =>
    renderer.root
      .findAll(
        (node) =>
          node.type === 'button' &&
          node.children.includes('Show more comments'),
      )[0]
      .props.onClick(),
  );
  expect(reads[0].path).toContain('after=older');
  await reply(null);
  expect(revealCommentComposer).toHaveBeenCalledTimes(1);
  await act(async () => toggle());
  await act(async () => toggle());
  await reply(null);
  expect(revealCommentComposer).toHaveBeenCalledTimes(2);
});

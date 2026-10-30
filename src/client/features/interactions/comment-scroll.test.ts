import { afterEach, expect, it, vi } from 'vitest';
import { revealCommentComposer } from './comment-scroll';

const rect = (top: number, bottom: number, left = 100, right = 600) => ({
  top,
  bottom,
  left,
  right,
});
function setup({
  bottom = 850,
  buttonTop = 400,
  nav = null,
  reduced = true,
  offsetTop = 0,
}: {
  bottom?: number;
  buttonTop?: number;
  nav?: ReturnType<typeof rect> | null;
  reduced?: boolean;
  offsetTop?: number;
} = {}) {
  const scrollTo = vi.fn();
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', {
    innerHeight: 800,
    scrollY: 100,
    visualViewport: { offsetTop, height: 800 - offsetTop },
    scrollTo,
    matchMedia: () => ({ matches: reduced }),
    addEventListener: (name: string, callback: () => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal('document', {
    querySelector: () => nav && { getBoundingClientRect: () => nav },
  });
  const button = {
    getBoundingClientRect: () => rect(buttonTop, buttonTop + 44),
  } as Element;
  const composer = {
    getBoundingClientRect: () => rect(bottom - 60, bottom),
  } as Element;
  return {
    run: () => revealCommentComposer(button, composer),
    scrollTo,
    listeners,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('leaves an input with sufficient padding alone', () => {
  const test = setup({ bottom: 780 });
  test.run();
  expect(test.scrollTo).not.toHaveBeenCalled();
});
it('reveals the full composer with 16px above the mobile navigation', () => {
  const test = setup({ nav: rect(720, 800, 0, 700) });
  test.run();
  expect(test.scrollTo).toHaveBeenCalledWith({ top: 246, behavior: 'instant' });
});
it('ignores the desktop sidebar', () => {
  const test = setup({ nav: rect(0, 800, 0, 72) });
  test.run();
  expect(test.scrollTo).toHaveBeenCalledWith({ top: 166, behavior: 'instant' });
});
it('caps long threads at the button, including a visual viewport offset', () => {
  const test = setup({ bottom: 1800, offsetTop: 30 });
  test.run();
  expect(test.scrollTo).toHaveBeenCalledWith({ top: 454, behavior: 'instant' });
});
it('never scrolls further when the button is already at the top', () => {
  const test = setup({ buttonTop: 10 });
  test.run();
  expect(test.scrollTo).not.toHaveBeenCalled();
});
it('finishes the eased animation in 180ms and removes interruption listeners', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const test = setup({ reduced: false });
  test.run();
  frame(90);
  expect(test.scrollTo).toHaveBeenLastCalledWith({
    top: 157.75,
    behavior: 'instant',
  });
  frame(180);
  expect(test.scrollTo).toHaveBeenLastCalledWith({
    top: 166,
    behavior: 'instant',
  });
  expect(test.listeners.size).toBe(0);
});
it('cancels animation on user scrolling or component cleanup', () => {
  vi.stubGlobal('requestAnimationFrame', () => 7);
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const test = setup({ reduced: false });
  const cleanup = test.run();
  test.listeners.get('wheel')?.();
  expect(cancel).toHaveBeenCalledWith(7);
  expect(test.listeners.size).toBe(0);
  cleanup?.();
});

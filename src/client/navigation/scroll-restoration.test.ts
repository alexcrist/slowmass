import { afterEach, expect, it, vi } from 'vitest';
import { restoreScroll } from './scroll-restoration';

function setup() {
  vi.useFakeTimers();
  const events = new EventTarget();
  let height = 200;
  let position = 0;
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.stubGlobal('document', { body: {} });
  const scrollTo = vi.fn(({ top }: { top: number }) => {
    position = Math.min(height, top);
  });
  vi.stubGlobal('window', {
    scrollTo,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  return {
    events,
    disconnect,
    scrollTo,
    position: () => position,
    grow(next: number) {
      height = next;
      resize();
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('restores instantly and reapplies after asynchronous content increases the available height', () => {
  const test = setup();
  const stop = restoreScroll(1400);
  expect(test.position()).toBe(200);
  test.grow(900);
  expect(test.position()).toBe(900);
  test.grow(2400);
  expect(test.position()).toBe(1400);
  expect(test.scrollTo).toHaveBeenLastCalledWith({
    top: 1400,
    behavior: 'instant',
  });
  stop();
  expect(test.disconnect).toHaveBeenCalledOnce();
});
it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])(
  'stops on %s so restoration does not fight the user',
  (event) => {
    const test = setup();
    restoreScroll(1400);
    test.events.dispatchEvent(new Event(event));
    expect(test.disconnect).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(20_000);
    expect(test.disconnect).toHaveBeenCalledOnce();
  },
);
it('bounds restoration when deleted content or failed reads leave a shorter page', () => {
  const test = setup();
  restoreScroll(1400);
  vi.advanceTimersByTime(20_000);
  expect(test.position()).toBe(200);
  expect(test.disconnect).toHaveBeenCalledOnce();
});
it('starts new pages at the top without observing later layout changes', () => {
  const test = setup();
  restoreScroll(0);
  expect(test.position()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

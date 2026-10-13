import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeReadActivity } from './visibility';

let observers: FakeObserver[];
class FakeObserver {
  observed = new Set<Element>();
  records: IntersectionObserverEntry[] = [];
  constructor(
    public callback: IntersectionObserverCallback,
    public options: IntersectionObserverInit,
  ) {
    observers.push(this);
  }
  observe = (element: Element) => this.observed.add(element);
  unobserve = (element: Element) => this.observed.delete(element);
  disconnect = () => this.observed.clear();
  takeRecords = () => this.records.splice(0);
  entry(target: Element, ratio: number) {
    return {
      target,
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
    } as IntersectionObserverEntry;
  }
  show(target: Element, ratio: number) {
    this.callback(
      [this.entry(target, ratio)],
      this as unknown as IntersectionObserver,
    );
  }
}
let cleanup: () => void;
beforeEach(() => {
  observers = [];
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      querySelector: () => ({
        getBoundingClientRect: () => ({ width: 400, top: 730, bottom: 800 }),
      }),
    }),
  );
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { innerWidth: 400, innerHeight: 800 }),
  );
});
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function start() {
  const element = {} as Element;
  const receipt = { key: 'request:bob', version: 1 };
  const seen = vi.fn();
  cleanup = observeReadActivity(new Map([[element, receipt]]), seen);
  return { element, receipt, seen };
}
it('requires 250 continuous visible milliseconds and excludes the mobile navigation', () => {
  const { element, receipt, seen } = start();
  const observer = observers[0];
  expect(observer.options).toMatchObject({
    threshold: 0.5,
    rootMargin: '0px 0px -70px 0px',
  });
  vi.advanceTimersByTime(1000);
  expect(seen).not.toHaveBeenCalled(); // Merely opening a list does not read it.
  observer.show(element, 0.49);
  vi.advanceTimersByTime(1000);
  expect(seen).not.toHaveBeenCalled();
  observer.show(element, 1);
  vi.advanceTimersByTime(249);
  expect(seen).not.toHaveBeenCalled();
  observer.show(element, 0);
  observer.show(element, 0.5);
  vi.advanceTimersByTime(249);
  expect(seen).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(seen).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(observer.observed.size).toBe(0);
  observer.show(element, 1);
  vi.advanceTimersByTime(1000);
  expect(seen).toHaveBeenCalledTimes(1);
});
it('resets the dwell period in a hidden tab and cancels unmounted timers', () => {
  const { element, seen } = start();
  observers[0].show(element, 1);
  vi.advanceTimersByTime(200);
  Object.assign(document, { visibilityState: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(1000);
  expect(seen).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  observers.at(-1)!.show(element, 1);
  vi.advanceTimersByTime(249);
  expect(seen).not.toHaveBeenCalled();
  cleanup();
  vi.advanceTimersByTime(1000);
  expect(seen).not.toHaveBeenCalled();
});
it('does not acknowledge an exit queued before a delayed timer runs', () => {
  const { element, seen } = start();
  observers[0].show(element, 1);
  observers[0].records.push(observers[0].entry(element, 0));
  vi.advanceTimersByTime(250);
  expect(seen).not.toHaveBeenCalled();
});

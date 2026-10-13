export type ReadReceipt = { key: string; version: number };

// Observe the summary rather than the entire row: a long comment can be taller
// than the viewport. Half of its summary must stay visible for 250 ms.
export function observeReadActivity(
  elements: Map<Element, ReadReceipt>,
  onSeen: (receipt: ReadReceipt) => void,
) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const completed = new Set<Element>();
  let observer: IntersectionObserver;
  function cancel(element: Element) {
    clearTimeout(timers.get(element));
    timers.delete(element);
  }
  function changes(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const element = entry.target;
      if (
        !entry.isIntersecting ||
        entry.intersectionRatio < 0.5 ||
        document.visibilityState === 'hidden'
      ) {
        cancel(element);
      } else if (!completed.has(element) && !timers.has(element)) {
        timers.set(
          element,
          setTimeout(() => {
            // Consume queued exits before accepting a delayed timer callback.
            changes(observer.takeRecords());
            if (!timers.has(element) || document.visibilityState === 'hidden')
              return;
            cancel(element);
            completed.add(element);
            observer.unobserve(element);
            const receipt = elements.get(element);
            if (receipt) onSeen(receipt);
          }, 250),
        );
      }
    }
  }
  function observe() {
    observer?.disconnect();
    for (const element of timers.keys()) cancel(element);
    if (document.visibilityState === 'hidden') return;
    const nav = document
      .querySelector('.app-navigation')
      ?.getBoundingClientRect();
    const covered =
      nav &&
      nav.width > window.innerWidth / 2 &&
      nav.bottom >= window.innerHeight
        ? Math.ceil(window.innerHeight - nav.top)
        : 0;
    observer = new IntersectionObserver(changes, {
      threshold: 0.5,
      rootMargin: `0px 0px -${covered}px 0px`,
    });
    for (const element of elements.keys())
      if (!completed.has(element)) observer.observe(element);
  }
  observe();
  document.addEventListener('visibilitychange', observe);
  window.addEventListener('resize', observe);
  return () => {
    observer?.disconnect();
    for (const element of timers.keys()) cancel(element);
    document.removeEventListener('visibilitychange', observe);
    window.removeEventListener('resize', observe);
  };
}

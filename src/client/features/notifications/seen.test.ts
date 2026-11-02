import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  UnreadActivityProvider,
  useOpenedActivity,
  useSeenActivity,
  type SeenMatch,
  type UnreadItem,
} from './seen';

// Simulated platform boundaries only: fetch, visibility and intersections.
let observers: {
  callback: IntersectionObserverCallback;
  observed: Element[];
}[];
let posts: { items: { key: string; version: number }[] }[];
let respond: (ok: boolean) => void;
let renderer: ReactTestRenderer;
const element = {} as Element;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  observers = [];
  posts = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observed: Element[] = [];
      constructor(public callback: IntersectionObserverCallback) {
        observers.push(this);
      }
      observe = (target: Element) => this.observed.push(target);
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
    },
  );
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      querySelector: () => null,
    }),
  );
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { innerWidth: 400, innerHeight: 800 }),
  );
  vi.stubGlobal('navigator', {});
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_path: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          posts.push(JSON.parse(options.body as string));
          respond = (ok) =>
            resolve(Response.json({ ok }, { status: ok ? 200 : 500 }));
        }),
    ),
  );
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unread: UnreadItem[] = [
  { key: 'comment:c1', since: 4, version: 4, handle: null },
  { key: 'likes:p1-abc', since: 5, version: 7, handle: null },
  { key: 'follower:u2', since: 6, version: 6, handle: 'bob' },
  { key: 'comment:c2', since: 8, version: 8, handle: null },
];
function Seen({ match }: { match: SeenMatch | null }) {
  return createElement('p', { ref: useSeenActivity(match) });
}
function Opened({ match }: { match: SeenMatch | null }) {
  useOpenedActivity(match);
  return null;
}
async function mount(
  child: ReturnType<typeof createElement>,
  onChange = vi.fn(),
) {
  await act(async () => {
    renderer = create(
      createElement(UnreadActivityProvider, {
        unread,
        onChange,
        children: child,
      }),
      { createNodeMock: () => element },
    );
  });
  return onChange;
}
async function show(ratio: number) {
  const observer = observers.at(-1)!;
  await act(async () => {
    observer.callback(
      [
        {
          target: element,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry,
      ],
      observer as unknown as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(250);
  });
}

it('reads matching unread activity once its content has been on screen for 250 ms', async () => {
  const onChange = await mount(
    createElement(Seen, {
      match: { keys: ['comment:c1'], prefixes: ['likes:p1-'] },
    }),
  );
  expect(observers).toHaveLength(1);
  await show(0.4);
  expect(posts).toHaveLength(0);
  await show(0.6);
  // The newest unread version, so the whole like group is read, but nothing
  // that does not match.
  expect(posts).toEqual([
    {
      items: [
        { key: 'comment:c1', version: 4 },
        { key: 'likes:p1-abc', version: 7 },
      ],
    },
  ]);
  await act(async () => respond(true));
  expect(onChange).toHaveBeenCalledOnce();
});

it('observes nothing and sends nothing when no unread activity matches', async () => {
  await mount(createElement(Seen, { match: { keys: ['comment:other'] } }));
  expect(observers).toHaveLength(0);
  await act(async () => renderer.update(createElement(Seen, { match: null })));
  expect(observers).toHaveLength(0);
  expect(posts).toHaveLength(0);
});

it('reads a profile’s follower activity once the page is open and visible, without repeats', async () => {
  Object.assign(document, { visibilityState: 'hidden' });
  const onChange = await mount(
    createElement(Opened, { match: { handle: 'bob' } }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(posts).toHaveLength(0);
  Object.assign(document, { visibilityState: 'visible' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(posts).toEqual([{ items: [{ key: 'follower:u2', version: 6 }] }]);
  // A second trigger before the badge refreshes does not send it again.
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(posts).toHaveLength(1);
  await act(async () => respond(true));
  expect(onChange).toHaveBeenCalledOnce();
});

it('retries on a later view after a failed acknowledgement', async () => {
  const onChange = await mount(
    createElement(Opened, { match: { keys: ['comment:c2'] } }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(posts).toHaveLength(1);
  await act(async () => respond(false));
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(posts).toHaveLength(2);
});

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../../api';
import { dismissPushNotifications } from '../push';
import { observeReadActivity, type ReadReceipt } from './visibility';

// An unread notification from the badge read: its oldest and newest unread
// versions, and the person for follower/joined activity.
export type UnreadItem = {
  key: string;
  since: number;
  version: number;
  handle: string | null;
};
// What a piece of content shows: exact notification keys, key prefixes (a
// like group or every answer to an event), or a person's profile.
export type SeenMatch = {
  keys?: string[];
  prefixes?: string[];
  handle?: string;
};

type Unread = {
  unread: UnreadItem[];
  acknowledge: (items: ReadReceipt[]) => void;
};
const UnreadActivity = createContext<Unread | null>(null);

// Seeing the thing a notification is about reads it, wherever that happens.
// Content compares itself with the unread list, so viewing costs no request
// unless something matching is unread. Acknowledgement goes through the
// versioned read API (newer activity stays unread), then refreshes the badge,
// which also closes this device's alerts. A failure leaves the item unread
// for Activity or the next view.
export function UnreadActivityProvider({
  unread,
  onChange,
  children,
}: {
  unread: UnreadItem[];
  onChange: () => void;
  children: ReactNode;
}) {
  const sent = useRef(new Set<string>());
  const acknowledge = useCallback(
    (items: ReadReceipt[]) => {
      const id = (item: ReadReceipt) => `${item.key}@${item.version}`;
      const batch = items
        .filter((item) => !sent.current.has(id(item)))
        .slice(0, 20);
      if (!batch.length) return;
      for (const item of batch) sent.current.add(id(item));
      api('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ items: batch }),
        timeoutMs: 15_000,
      })
        .then(() => {
          onChange();
          void dismissPushNotifications(batch).catch(() => {});
        })
        .catch(() => {
          for (const item of batch) sent.current.delete(id(item));
        });
    },
    [onChange],
  );
  const value = useMemo(() => ({ unread, acknowledge }), [unread, acknowledge]);
  return <UnreadActivity value={value}>{children}</UnreadActivity>;
}

function useMatching(match: SeenMatch | null) {
  const context = useContext(UnreadActivity);
  const signature = match ? JSON.stringify(match) : '';
  const receipts = useMemo(() => {
    if (!context || !signature) return '';
    const {
      keys = [],
      prefixes = [],
      handle,
    } = JSON.parse(signature) as SeenMatch;
    const items = context.unread
      .filter(
        (item) =>
          keys.includes(item.key) ||
          prefixes.some((prefix) => item.key.startsWith(prefix)) ||
          (handle !== undefined && item.handle === handle),
      )
      .map(({ key, version }) => ({ key, version }));
    // A string keeps observers stable while the list itself is refetched.
    return items.length ? JSON.stringify(items) : '';
  }, [context, signature]);
  return { receipts, acknowledge: context?.acknowledge };
}

// Content seen on screen: the returned ref's element must be at least half
// visible for 250 ms, the Activity rule.
export function useSeenActivity<T extends Element>(match: SeenMatch | null) {
  const [element, setElement] = useState<T | null>(null);
  const { receipts, acknowledge } = useMatching(match);
  useEffect(() => {
    if (!element || !receipts || !acknowledge) return;
    const items = JSON.parse(receipts) as ReadReceipt[];
    return observeReadActivity(new Map([[element, items[0]]]), () =>
      acknowledge(items),
    );
  }, [element, receipts, acknowledge]);
  return setElement;
}

// A page whose opening shows the activity, such as an event's answers or a
// profile: visible for 250 ms.
export function useOpenedActivity(match: SeenMatch | null) {
  const { receipts, acknowledge } = useMatching(match);
  useEffect(() => {
    if (!receipts || !acknowledge) return;
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden')
        timer = setTimeout(
          () => acknowledge(JSON.parse(receipts) as ReadReceipt[]),
          250,
        );
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', start);
    };
  }, [receipts, acknowledge]);
}

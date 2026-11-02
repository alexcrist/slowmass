import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { closeReadPushNotifications, onPushReceived } from '../push';

type Unread = {
  count: number;
  unread: { key: string; since: number }[];
  complete: boolean;
};

export function useNotificationCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const lastSuccess = useRef<number | null>(null);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const requestedAt = Date.now();
    api<Unread>(
      '/api/notifications/unread-count?includeJoined=1&includeEvents=1&includeHosting=1&includeComments=1&includeUnread=1',
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          lastSuccess.current = Date.now();
          setCount(data.count);
          // Alerts for anything read since, here or elsewhere, leave the tray.
          if (Array.isArray(data.unread))
            void closeReadPushNotifications(
              data.unread,
              data.complete === true,
              requestedAt,
            ).catch(() => {});
        }
      })
      // Keep the last confirmed count on temporary failure, never assume zero.
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        if (active.current === controller) active.current = null;
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
      if (active.current === controller) active.current = null;
    };
  }, [enabled, revision]);

  // A newly shown alert means the count changed.
  useEffect(
    () => (enabled ? onPushReceived(refresh) : undefined),
    [enabled, refresh],
  );

  useEffect(() => {
    if (!enabled) return;
    const visibleRefresh = () => {
      if (
        document.visibilityState !== 'hidden' &&
        !active.current &&
        (lastSuccess.current === null ||
          Date.now() - lastSuccess.current >= 30_000)
      )
        refresh();
    };
    const timer = setInterval(visibleRefresh, 60_000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    window.addEventListener('hashchange', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      window.removeEventListener('hashchange', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [enabled, refresh]);

  return { count: enabled ? count : null, refresh };
}

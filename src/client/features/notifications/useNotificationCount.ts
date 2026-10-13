import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

export function useNotificationCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    api<{ count: number }>('/api/notifications/unread-count?includeJoined=1', {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setCount(data.count);
      })
      // Keep the last confirmed count on temporary failure, never assume zero.
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, revision]);

  useEffect(() => {
    if (!enabled) return;
    const visibleRefresh = () => {
      if (document.visibilityState !== 'hidden') refresh();
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

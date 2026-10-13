import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { dismissPushNotifications } from '../push';
import { observeReadActivity, type ReadReceipt } from './visibility';

const noChange = () => {};
export function useReadActivity(
  items: (ReadReceipt & { unread: boolean })[] | undefined,
  onChange: () => void = noChange,
) {
  const list = useRef<HTMLUListElement>(null);
  const [failure, setFailure] = useState<{
    items: typeof items;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!items || !list.current) return;
    const elements = new Map<Element, ReadReceipt>();
    for (const element of list.current.querySelectorAll(
      '[data-notification-key]',
    )) {
      const item = items.find(
        (item) => item.key === element.getAttribute('data-notification-key'),
      );
      if (item?.unread)
        elements.set(element, { key: item.key, version: item.version });
    }
    if (!elements.size) return;
    const queue = new Map<string, ReadReceipt>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let retryDelay = 1000;
    async function flush() {
      if (disposed || controller || !queue.size) return;
      if (document.visibilityState === 'hidden') return;
      const batch = [...queue.values()].slice(0, 20);
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      let delay = 0;
      try {
        await api('/api/notifications/read', {
          method: 'POST',
          body: JSON.stringify({ items: batch }),
          signal: controller.signal,
        });
        if (disposed) return;
        for (const item of batch) queue.delete(item.key);
        setFailure(null);
        retryDelay = 1000;
        onChange();
        void dismissPushNotifications(batch).catch(() => {});
      } catch {
        if (disposed) return;
        setFailure({ items, message: 'Could not save read status. Retrying…' });
        delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30_000);
      } finally {
        clearTimeout(timeout);
        controller = null;
        if (!disposed && queue.size)
          timer = setTimeout(() => void flush(), delay);
      }
    }
    const stop = observeReadActivity(elements, (receipt) => {
      queue.set(receipt.key, receipt);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 0);
    });
    const resume = () => void flush();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      stop();
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [items, onChange]);
  return { list, readError: failure?.items === items ? failure?.message : '' };
}

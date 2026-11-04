import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

type Page<T> = { items: T[]; next: string | null };
// Reload the first `depth` pages as one cursor chain, or append the page after
// a cursor. Reloading the chain keeps loaded pages contiguous after mutations.
type Load = { depth: number } | { after: string };

export type ScrollPages<T> = ReturnType<typeof useScrollPages<T>>;

// A server-paginated list that appends its next page as the end nears the
// viewport, or only through a Show more button when `automatic` is false
// (lists with a composer below them, which scrolling must be able to reach).
// The history store (usually `usePageHistory`) remembers how many pages were
// loaded, never the responses, so returning to the list rereads that many
// pages fresh. Callers remount (key) the list when its identity changes.
export function useScrollPages<T>({
  history: [history, setHistory],
  path,
  identify,
  automatic = true,
}: {
  history: readonly [string[], (pages: string[]) => void];
  path: (cursor: string) => string;
  identify: (item: T) => string;
  automatic?: boolean;
}) {
  const [request, setRequest] = useState<Load>(() => ({
    depth: history.length,
  }));
  const [pages, setPages] = useState<Page<T>[] | null>(null);
  const [result, setResult] = useState<{ request: Load; error: string } | null>(
    null,
  );
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const loading = result?.request !== request;
  const loadError = loading ? '' : (result?.error ?? '');
  const latest = useRef({ path, identify, pages, setHistory });
  useEffect(() => {
    latest.current.path = path;
    latest.current.identify = identify;
    latest.current.setHistory = setHistory;
  });
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const read = async (cursor: string) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      return api<Page<T>>(latest.current.path(cursor), {
        signal: controller.signal,
      });
    };
    void (async () => {
      try {
        let loaded: Page<T>[] | null = null;
        let added: Page<T> | null = null;
        if ('after' in request) added = await read(request.after);
        else {
          loaded = [];
          let cursor = '';
          while (loaded.length < request.depth) {
            const page = await read(cursor);
            loaded.push(page);
            if (!page.next) break;
            cursor = page.next;
          }
        }
        if (controller.signal.aborted) return;
        setPages(
          (current) =>
            loaded ?? (current && added ? [...current, added] : current),
        );
        setResult({ request, error: '' });
      } catch (e) {
        if (controller.signal.aborted && !timedOut) return;
        setResult({
          request,
          error: timedOut
            ? 'This page took too long to load. Please try again.'
            : e instanceof Error
              ? e.message
              : 'Could not load this page. Please try again.',
        });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [request]);
  // A revalidation can pull the next page's first row onto an earlier page;
  // show each item once.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return pages
      ?.flatMap((page) => page.items)
      .filter((item) => {
        const id = latest.current.identify(item);
        return !seen.has(id) && Boolean(seen.add(id));
      });
  }, [pages]);
  useEffect(() => {
    if (!pages || latest.current.pages === pages) return;
    latest.current.pages = pages;
    latest.current.setHistory([
      '',
      ...pages.slice(0, -1).map((page) => page.next ?? ''),
    ]);
  }, [pages]);
  const depth = pages?.length ?? history.length;
  const after = loading || loadError ? null : pages?.at(-1)?.next;
  // Fetch the next page once the end of the list nears the viewport, or the
  // bottom of an enclosing dialog, which scrolls on its own. A fresh observer
  // per loaded page reports immediately, so short lists keep filling.
  useEffect(() => {
    if (
      !automatic ||
      !after ||
      !sentinel ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRequest({ after });
      },
      { root: sentinel.closest('dialog'), rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [automatic, after, sentinel]);
  const revalidate = () => setRequest({ depth });
  return {
    items,
    depth,
    loading,
    // Only an appended page is loading; loaded items stay in place.
    appending: loading && 'after' in request,
    // Loaded items are being reread; hold mutations until they are current.
    revalidating: loading && !('after' in request),
    loadError,
    // The list has loaded through its last page.
    complete: !loading && !loadError && pages?.at(-1)?.next === null,
    sentinel: setSentinel,
    // A button appends the next page when loading is not automatic or
    // IntersectionObserver is unavailable.
    more:
      after && (!automatic || typeof IntersectionObserver === 'undefined')
        ? () => setRequest({ after })
        : null,
    retry: () => setRequest({ ...request }),
    reload: (depth: number) => setRequest({ depth }),
    // Reread every loaded page as one fresh cursor chain.
    revalidate,
    // Apply a confirmed mutation, then revalidate every loaded page.
    update(change: (items: T[]) => T[]) {
      setPages(
        (current) =>
          current?.map((page) => ({ ...page, items: change(page.items) })) ??
          null,
      );
      revalidate();
    },
  };
}

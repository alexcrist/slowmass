import { useEffect, useState } from 'react';
import { api } from './index';

export function useApiResource<T>(path: string) {
  // A fresh object identifies each read, including retries of the same URL.
  const [request, setRequest] = useState(() => ({ path, preserveData: false }));
  const [result, setResult] = useState<{
    request: typeof request;
    data: T | null;
    error: string;
  } | null>(null);
  if (request.path !== path) setRequest({ path, preserveData: false });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setResult({
        request,
        data: null,
        error: 'This page took too long to load. Please try again.',
      });
    }, 15_000);
    api<T>(request.path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ request, data, error: '' });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            request,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load this page. Please try again.',
          });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [request]);

  const current =
    request.path === path &&
    (result?.request === request ||
      (request.preserveData && result?.request.path === path))
      ? result
      : null;
  const loading = request.path !== path || result?.request !== request;
  return {
    data: current?.data ?? null,
    error: loading ? '' : (current?.error ?? ''),
    loading,
    reload: () => setRequest({ path, preserveData: false }),
    refresh: (update?: (data: T) => T) => {
      // Apply only a confirmed mutation to this read's data. The new GET still
      // owns authorization, pagination, and any concurrent changes.
      if (update)
        setResult((current) =>
          current &&
          current.data !== null &&
          (current.request === request ||
            (request.preserveData && current.request.path === path))
            ? { ...current, data: update(current.data) }
            : current,
        );
      setRequest({ path, preserveData: true });
    },
  };
}

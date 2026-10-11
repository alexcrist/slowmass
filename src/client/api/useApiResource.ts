import { useEffect, useState } from 'react';
import { api } from './index';

export function useApiResource<T>(path: string) {
  // A fresh object identifies each read, including retries of the same URL.
  const [request, setRequest] = useState(() => ({ path }));
  const [result, setResult] = useState<{
    request: typeof request;
    data: T | null;
    error: string;
  } | null>(null);
  if (request.path !== path) setRequest({ path });

  useEffect(() => {
    const controller = new AbortController();
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
      });
    return () => controller.abort();
  }, [request]);

  const current =
    request.path === path && result?.request === request ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: current === null,
    reload: () => setRequest({ path }),
  };
}

import { separateReads, sharedRead } from './reads';
import { withDeadline } from './deadline';
import { uploadResponse } from './upload';

type ApiOptions = RequestInit & {
  timeoutMs?: number;
  onUploadProgress?: (percent: number | null) => void;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void) {
  separateReads();
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
    separateReads();
  };
}

async function request(path: string, options?: ApiOptions): Promise<unknown> {
  const listeners = [...unauthorizedListeners];
  const { onUploadProgress, ...fetchOptions } = options ?? {};
  delete fetchOptions.timeoutMs;
  const response =
    onUploadProgress &&
    fetchOptions.body instanceof Blob &&
    fetchOptions.method === 'PUT'
      ? await uploadResponse(
          path,
          fetchOptions.body,
          fetchOptions.headers,
          fetchOptions.signal,
          onUploadProgress,
        )
      : await fetch(path, fetchOptions);
  const body: unknown = await response.json().catch(() => null);
  const error =
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof body.error === 'string'
      ? body.error
      : 'The request failed. Please try again.';
  if (!response.ok) {
    if (response.status === 401 && !options?.signal?.aborted) {
      // Notify each mounted session once. Late responses from an unsubscribed
      // session cannot invalidate a subsequent sign-in.
      for (const listener of listeners)
        if (unauthorizedListeners.delete(listener)) {
          separateReads();
          listener();
        }
    }
    throw new ApiError(error, response.status);
  }
  if (
    onUploadProgress &&
    !(
      body &&
      typeof body === 'object' &&
      (('ok' in body && body.ok === true) ||
        ('state' in body && body.state === 'published'))
    )
  )
    throw new Error(
      'The upload response could not be confirmed. Retry the same photo to check whether it saved.',
    );
  return body;
}

export async function api<T>(path: string, options?: ApiOptions): Promise<T> {
  const method = options?.method?.toUpperCase() ?? 'GET';
  // Only ordinary same-origin reads share work. Custom headers, credentials,
  // cache modes and other fetch options retain their exact transport semantics.
  if (
    method === 'GET' &&
    Object.keys(options ?? {}).every(
      (key) => key === 'method' || key === 'signal',
    )
  )
    return (await sharedRead(path, options?.signal, (signal) =>
      request(path, { ...options, signal }),
    )) as T;
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutation) separateReads();
  const controller = options?.timeoutMs ? new AbortController() : null;
  const abort = () => controller?.abort();
  if (options?.signal?.aborted) abort();
  else options?.signal?.addEventListener('abort', abort, { once: true });
  try {
    const pending = request(
      path,
      controller ? { ...options, signal: controller.signal } : options,
    );
    return (await (controller && options?.timeoutMs
      ? withDeadline(pending, controller.signal, {
          milliseconds: options.timeoutMs,
          message:
            'The request took too long to confirm. Check your connection, then try again with the same details.',
        })
      : pending)) as T;
  } finally {
    controller?.abort();
    options?.signal?.removeEventListener('abort', abort);
    // A read started during the mutation can also predate its commit.
    if (mutation) separateReads();
  }
}
export function jsonRequest(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

export { withDeadline } from './deadline';

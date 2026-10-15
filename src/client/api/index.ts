import { separateReads, sharedRead } from './reads';

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

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const listeners = [...unauthorizedListeners];
  const response = await fetch(path, options);
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
  return body;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
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
  try {
    return (await request(path, options)) as T;
  } finally {
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

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
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
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
        if (unauthorizedListeners.delete(listener)) listener();
    }
    throw new ApiError(error, response.status);
  }
  return body as T;
}
export function jsonRequest(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

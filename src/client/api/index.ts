export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body: unknown = await response.json().catch(() => null);
  const error =
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof body.error === 'string'
      ? body.error
      : 'The request failed. Please try again.';
  if (!response.ok) throw new Error(error);
  return body as T;
}
export function jsonRequest(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

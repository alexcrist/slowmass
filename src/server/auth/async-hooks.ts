// Workers must not retain a request-owned dynamic import across invocations.
// Remove this adapter once Better Auth ships an equivalent workerd entry.
// https://github.com/better-auth/better-auth/issues/10315
import { AsyncLocalStorage } from 'node:async_hooks';
export async function getAsyncLocalStorage() {
  return AsyncLocalStorage;
}

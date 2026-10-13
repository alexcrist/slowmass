import type { Profile } from '../people';
export type Bootstrap = {
  signInAvailable: boolean;
  user: { id: string; name: string } | null;
  profile: Profile | null;
};
function validBootstrap(value: unknown): value is Bootstrap {
  if (!value || typeof value !== 'object') return false;
  if (
    !('signInAvailable' in value) ||
    typeof value.signInAvailable !== 'boolean' ||
    !('user' in value) ||
    !('profile' in value)
  )
    return false;
  const { user, profile } = value;
  if (
    user !== null &&
    (!user ||
      typeof user !== 'object' ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !('name' in user) ||
      typeof user.name !== 'string')
  )
    return false;
  return (
    profile === null ||
    (!!profile &&
      typeof profile === 'object' &&
      'handle' in profile &&
      typeof profile.handle === 'string' &&
      'displayName' in profile &&
      typeof profile.displayName === 'string' &&
      'bio' in profile &&
      typeof profile.bio === 'string' &&
      'hasAvatar' in profile &&
      (profile.hasAvatar === 0 || profile.hasAvatar === 1))
  );
}
type Failure = {
  attempt: number;
  outcome: 'network' | 'http' | 'timeout' | 'invalid_response';
  durationMs: number;
  status: number | null;
  requestId: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Race the entire read, including the body. Some transports ignore abort.
export async function loadStartup(signal: AbortSignal): Promise<Bootstrap> {
  const startupId = crypto.randomUUID();
  const failures: Failure[] = [];
  const started = Date.now();
  let recovered = false;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      signal.throwIfAborted();
      const controller = new AbortController();
      const start = Date.now();
      const failure: Failure = {
        attempt,
        outcome: 'network',
        durationMs: 0,
        status: null,
        requestId: null,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel = () => {};
      try {
        const interrupted = new Promise<never>((_, reject) => {
          cancel = () => {
            controller.abort();
            reject(new Error('Cancelled'));
          };
          signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(
            () => {
              failure.outcome = 'timeout';
              controller.abort();
              reject(new Error('Startup timeout'));
            },
            Math.min(10_000, 20_000 - (Date.now() - started)),
          );
        });
        const read = async () => {
          const response = await fetch('/api/bootstrap', {
            signal: controller.signal,
            headers: {
              'X-Startup-Id': startupId,
              'X-Startup-Attempt': String(attempt),
            },
          });
          failure.status = response.status;
          const id = response.headers.get('X-Request-Id');
          failure.requestId = id && uuid.test(id) ? id : null;
          if (!response.ok) {
            failure.outcome = 'http';
            throw new Error('Startup HTTP error');
          }
          failure.outcome = 'network';
          let body: unknown;
          try {
            body = await response.json();
          } catch (error) {
            if (error instanceof SyntaxError)
              failure.outcome = 'invalid_response';
            throw error;
          }
          if (!validBootstrap(body)) {
            failure.outcome = 'invalid_response';
            throw new Error('Invalid bootstrap');
          }
          return body;
        };
        const result = await Promise.race([read(), interrupted]);
        recovered = true;
        return result;
      } catch (error) {
        if (signal.aborted) throw error;
        failure.durationMs = Math.min(20_000, Date.now() - start);
        failures.push({ ...failure });
        if (
          attempt === 2 ||
          failure.outcome === 'invalid_response' ||
          (failure.outcome === 'http' &&
            failure.status !== 408 &&
            (failure.status ?? 0) < 500)
        )
          throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      }
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', cancel);
          resolve();
        }, 500);
        signal.addEventListener('abort', cancel, { once: true });
      });
    }
    throw new Error('Startup unavailable');
  } finally {
    if (failures.length && !signal.aborted) {
      // Best effort, no cookies, no retries, and no dependency on reporting for UI.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      void fetch('/api/startup-diagnostics', {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startupId, recovered, failures }),
      })
        .catch(() => {})
        .finally(() => clearTimeout(timer));
    }
  }
}

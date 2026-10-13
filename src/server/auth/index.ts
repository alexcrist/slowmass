import { startupPhase } from '../telemetry';
import { betterAuth } from 'better-auth';
import type { Env } from '../env';
import { authOptions } from './options';
import { memberAccess } from '../membership';

type Auth = ReturnType<typeof betterAuth>;
const instances = new WeakMap<Env, Auth>();
export function createAuth(env: Env) {
  const cached = instances.get(env);
  if (cached) return cached;
  const auth = betterAuth(authOptions(env));
  // Cache only completed initialization. An abandoned first request must never
  // leave other requests waiting on its permanently pending context promise.
  void auth.$context.then(
    () => {
      if (!instances.has(env)) instances.set(env, auth);
    },
    () => {},
  );
  return auth;
}
export class AuthUnavailableError extends Error {
  constructor() {
    super('Sign-in is temporarily unavailable. Please try again.');
    this.name = 'AuthUnavailableError';
  }
}
async function authOperation<T>(
  env: Env,
  kind: 'session' | 'handler',
  action: (auth: Auth) => Promise<T>,
) {
  startupPhase('initialize');
  const auth = createAuth(env);
  let phase: 'initialize' | 'session' | 'handler' = 'initialize';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    return await Promise.race([
      (async () => {
        await auth.$context;
        if (expired) throw new AuthUnavailableError();
        phase = kind;
        startupPhase(kind);
        return action(auth);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            expired = true;
            startupPhase(phase, true);
            if (instances.get(env) === auth) instances.delete(env);
            console.error(JSON.stringify({ event: 'auth.timeout', phase }));
            reject(new AuthUnavailableError());
          },
          kind === 'session' ? 8000 : 20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function handleAuthRequest(env: Env, request: Request) {
  // Do not automatically replay auth mutations after an ambiguous timeout.
  return authOperation(env, 'handler', (auth) => auth.handler(request));
}

export async function getActiveSession(env: Env, headers: Headers) {
  const session = await authOperation(env, 'session', (auth) =>
    auth.api.getSession({ headers }),
  );
  startupPhase('membership');
  if (!session?.user.emailVerified) return null;
  const access = await memberAccess(env.DB, session.user.id);
  if (!access) return null;
  return {
    user: { id: session.user.id, name: session.user.name },
    sessionId: session.session.id,
    hasProfilePhoto: access.hasProfilePhoto,
  };
}

export async function getActiveUser(env: Env, headers: Headers) {
  return (await getActiveSession(env, headers))?.user ?? null;
}

export async function cleanupAuth(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'DELETE FROM verification WHERE id IN(SELECT id FROM verification WHERE expiresAt<? LIMIT 100)',
      )
      .bind(now),
    db
      .prepare(
        'DELETE FROM session WHERE id IN(SELECT id FROM session WHERE expiresAt<? LIMIT 100)',
      )
      .bind(now),
  ]);
}

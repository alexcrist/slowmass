import { startupPhase, sessionStage } from '../telemetry';
import { betterAuth } from 'better-auth';
import type { Env } from '../env';
import { authOptions } from './options';
import { memberAccess } from '../membership';

type Auth = ReturnType<typeof betterAuth>;
export function createAuth(env: Env) {
  // A resolved $context does not establish that all lazy library state is safe
  // to reuse after its owning Workers request ends. Keep the whole instance
  // request-local; cookies, secrets and persisted sessions remain unchanged.
  return betterAuth(authOptions(env));
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
        if (kind === 'session') sessionStage('dispatch');
        return action(auth);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            expired = true;
            startupPhase(phase, true);
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

async function readActiveSession(env: Env, headers: Headers, renew: boolean) {
  const { headers: responseHeaders, response: session } = await authOperation(
    env,
    'session',
    (auth) =>
      auth.api.getSession({
        headers,
        query: { disableRefresh: !renew },
        returnHeaders: true,
      }),
  );
  startupPhase('membership');
  const cookies = responseHeaders.getSetCookie();
  if (!session?.user.emailVerified) return { session: null, cookies };
  const access = await memberAccess(env.DB, session.user.id);
  if (!access) return { session: null, cookies };
  return {
    session: {
      user: { id: session.user.id, name: session.user.name },
      sessionId: session.session.id,
      hasProfilePhoto: access.hasProfilePhoto,
    },
    cookies,
  };
}

export async function getActiveSession(env: Env, headers: Headers) {
  return (await readActiveSession(env, headers, false)).session;
}

export async function getActiveUser(env: Env, headers: Headers) {
  return (await getActiveSession(env, headers))?.user ?? null;
}

// Renewal extends the session row and reissues its cookie, so only a response
// that forwards these Set-Cookie values may renew. Every app start calls
// bootstrap; other reads skip renewal rather than extend only the row.
export async function renewActiveUser(env: Env, headers: Headers) {
  const { session, cookies } = await readActiveSession(env, headers, true);
  return { user: session?.user ?? null, cookies };
}

// Better Auth stores dates as ISO-8601 text. SQLite orders every number before
// every text value, so raw comparisons with those columns must use this format.
export function authDate() {
  return new Date().toISOString();
}

export async function cleanupAuth(db: D1Database) {
  const now = authDate();
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

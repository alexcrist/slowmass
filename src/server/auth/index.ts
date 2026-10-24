import { startupPhase, sessionStage } from '../telemetry';
import { betterAuth } from 'better-auth';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { authConfigured, authOptions } from './options';
import { memberAccess } from '../membership';
import { signInRecoveryPath } from '../../shared/sign-in';

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
export async function handleAuthRequest(env: Env, request: Request) {
  // Do not automatically replay auth mutations after an ambiguous timeout.
  const response = await authOperation(env, 'handler', (auth) =>
    auth.handler(request),
  );
  const url = new URL(request.url);
  if (
    request.method === 'GET' &&
    url.pathname === '/api/auth/magic-link/verify' &&
    response.status >= 400
  )
    return new Response(null, {
      status: 303,
      headers: {
        Location: signInRecoveryPath(
          url.searchParams.get('errorCallbackURL'),
          env.APP_ORIGIN,
        ),
      },
    });
  // Lifecycle hooks can reject after the provider's normal error redirect.
  // Keep browser navigation on the sign-in screen even for those failures.
  if (
    request.method === 'GET' &&
    url.pathname === '/api/auth/callback/google' &&
    response.status >= 400
  )
    return new Response(null, {
      status: 303,
      headers: { Location: '/?auth=google&error=signin' },
    });
  return response;
}

async function readActiveSession<T>(
  env: Env,
  headers: Headers,
  renew: boolean,
  load: (userId: string) => Promise<T>,
) {
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
  // A read-only load runs alongside the fresh membership check, saving one D1
  // round trip. Its result and errors are discarded unless access is granted.
  const [access, loaded] = await Promise.all([
    memberAccess(env.DB, session.user.id),
    load(session.user.id).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
  ]);
  if (!access) return { session: null, cookies };
  if ('error' in loaded) throw loaded.error;
  return {
    session: {
      user: { id: session.user.id, name: session.user.name },
      sessionId: session.session.id,
      hasProfilePhoto: access.hasProfilePhoto,
    },
    cookies,
    value: loaded.value,
  };
}

export async function getActiveSession(env: Env, headers: Headers) {
  return (await readActiveSession(env, headers, false, async () => null))
    .session;
}

export async function getActiveUser(env: Env, headers: Headers) {
  return (await getActiveSession(env, headers))?.user ?? null;
}

// For read-only lookups only: `load` runs before membership is confirmed, so
// it must not write, enqueue work, or have other side effects.
export async function readAsMember<T>(
  env: Env,
  headers: Headers,
  load: (userId: string) => Promise<T>,
) {
  const { session, value } = await readActiveSession(env, headers, false, load);
  return session && { session, value };
}

type MemberEnv = { Bindings: Env; Variables: { userId: string } };
// Requires an active member, and optionally a profile photo. GET handlers
// behind this gate must be read-only: they run alongside the membership check
// and their response is replaced when access is denied.
export function memberGate(
  requireProfilePhoto: boolean,
): MiddlewareHandler<MemberEnv> {
  return async (c, next) => {
    if (!authConfigured(c.env))
      return c.json({ error: 'Sign-in is not available yet.' }, 503);
    const concurrent = c.req.method === 'GET';
    const { session } = await readActiveSession(
      c.env,
      c.req.raw.headers,
      false,
      async (userId) => {
        if (!concurrent) return;
        c.set('userId', userId);
        await next();
      },
    );
    const denied = !session
      ? c.json({ error: 'Sign in to continue.' }, 401)
      : requireProfilePhoto && !session.hasProfilePhoto
        ? c.json(
            { error: 'Add a profile photo to finish setting up your account.' },
            409,
          )
        : null;
    if (concurrent) {
      // Discard the handler's response rather than merging its headers.
      if (denied) {
        c.res = undefined;
        c.res = denied;
      }
      return;
    }
    if (!session || denied) return denied ?? undefined;
    c.set('userId', session.user.id);
    await next();
  };
}

// Renewal extends the session row and reissues its cookie, so only a response
// that forwards these Set-Cookie values may renew. Every app start calls
// bootstrap; other reads skip renewal rather than extend only the row.
// `load` follows the same read-only contract as readAsMember.
export async function renewActiveUser<T>(
  env: Env,
  headers: Headers,
  load: (userId: string) => Promise<T>,
) {
  const { session, cookies, value } = await readActiveSession(
    env,
    headers,
    true,
    load,
  );
  return session
    ? { user: session.user, cookies, value }
    : { user: null, cookies, value: null };
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

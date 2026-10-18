import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import type { Env } from '../env';
import {
  canJoin,
  ensureMembership,
  activeMember,
  claimSource,
  bindEventVerification,
  eventClaim,
  acceptEventVerification,
  bindInviteVerification,
  inviteClaim,
  acceptInviteVerification,
} from '../membership';
import { emailConfigured, sendLoginEmail } from '../email';
import { sessionStage } from '../telemetry';

export function authConfigured(env: Env): boolean {
  return Boolean(
    env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 && emailConfigured(env),
  );
}

function forbidden(): never {
  throw new APIError('FORBIDDEN', {
    message: 'An invite link or event link from an active member is required.',
  });
}
export function authOptions(env: Env): BetterAuthOptions {
  const linkVerifications = new WeakMap<Request, 'event' | 'invite'>();
  // Which link's claim, if any, is bound to this email token.
  async function linkVerification(
    token: string | null,
    request: Request | undefined,
  ) {
    if (!token || !request) return null;
    const known = linkVerifications.get(request);
    if (known) return known;
    const source = await claimSource(env.DB, token);
    // Keep the source from before token consumption through session issuance.
    // Cleanup can remove the claim in between; it must fail, not fall back.
    if (source) linkVerifications.set(request, source);
    return source;
  }
  return {
    appName: 'slowmass',
    baseURL: env.APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: env.DB,
    // Library errors can include SQL parameters (including session tokens).
    // Route/request diagnostics come from the Worker's sanitized telemetry.
    logger: {
      log(level) {
        console[level](JSON.stringify({ event: 'auth.library', level }));
      },
    },
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: { enabled: false },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    plugins: [
      {
        id: 'session-diagnostics',
        hooks: {
          before: [
            {
              matcher: (ctx) => ctx.path === '/get-session',
              handler: createAuthMiddleware(async (ctx) => {
                sessionStage('endpoint');
                const findSession = ctx.context.internalAdapter.findSession;
                ctx.context.internalAdapter = {
                  ...ctx.context.internalAdapter,
                  findSession: (...args) => {
                    sessionStage('lookup');
                    return findSession(...args);
                  },
                };
              }),
            },
          ],
        },
      },
      {
        id: 'link-verification',
        hooks: {
          before: [
            {
              matcher: (ctx) => ctx.path === '/magic-link/verify',
              handler: createAuthMiddleware(async (ctx) => {
                const token =
                  typeof ctx.query?.token === 'string' ? ctx.query.token : null;
                await linkVerification(token, ctx.request);
              }),
            },
          ],
        },
      },
      magicLink({
        expiresIn: 600,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 3 },
        sendMagicLink: async ({ email, url, token, metadata }) => {
          const user = await env.DB.prepare(
            'SELECT id FROM user WHERE lower(email) = ?',
          )
            .bind(email.trim().toLowerCase())
            .first<{ id: string }>();
          const existing = user && (await activeMember(env.DB, user.id));
          // Signing in through an event link records the link for members too;
          // members sign in through an invite link as they normally would.
          const eligible =
            metadata?.eventLink !== undefined
              ? await bindEventVerification(
                  env.DB,
                  metadata.eventLink,
                  email,
                  token,
                  Boolean(existing),
                )
              : existing ||
                (metadata?.inviteLink !== undefined
                  ? await bindInviteVerification(
                      env.DB,
                      metadata.inviteLink,
                      email,
                      token,
                    )
                  : await canJoin(env.DB, email, env.BOOTSTRAP_EMAIL));
          if (!eligible)
            throw new APIError('FORBIDDEN', {
              code: 'INVITATION_REQUIRED',
              message: 'Ask a slowmass member to text you an invite link.',
            });
          await sendLoginEmail(env, email, url);
        },
      }),
    ],
    account: { accountLinking: { enabled: false } },
    // Sliding sixty-day sessions; only bootstrap renews them (see index.ts).
    session: { cookieCache: { enabled: false }, expiresIn: 60 * 86400 },
    advanced: {
      // Migrations and an explicit CI check validate the schema. A request-owned
      // runtime schema promise can otherwise stall every session in an isolate.
      database: { validateSchema: false, joins: true },
      useSecureCookies: env.APP_ORIGIN.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const token =
              ctx?.path === '/magic-link/verify' &&
              typeof ctx.query?.token === 'string'
                ? ctx.query.token
                : null;
            const source = await linkVerification(token, ctx?.request);
            if (
              !user.emailVerified ||
              !(source && token
                ? await (source === 'event' ? eventClaim : inviteClaim)(
                    env.DB,
                    token,
                    user.email,
                  )
                : await canJoin(env.DB, user.email, env.BOOTSTRAP_EMAIL))
            )
              forbidden();
            return {
              data: {
                ...user,
                email: user.email.trim().toLowerCase(),
                image: null,
              },
            };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const token =
              ctx?.path === '/magic-link/verify' &&
              typeof ctx.query?.token === 'string'
                ? ctx.query.token
                : null;
            // Signing in through a link joins new people first; event links
            // also record the link for members.
            const source = await linkVerification(token, ctx?.request);
            if (token && source)
              return (await (
                source === 'event'
                  ? acceptEventVerification
                  : acceptInviteVerification
              )(env.DB, session.userId, token))
                ? { data: session }
                : forbidden();
            if (
              !(await ensureMembership(
                env.DB,
                session.userId,
                env.BOOTSTRAP_EMAIL,
              ))
            )
              forbidden();
            return { data: session };
          },
        },
      },
    },
  };
}

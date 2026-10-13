import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import type { Env } from '../env';
import { canJoin, ensureMembership, activeMember } from '../membership';
import { emailConfigured, sendLoginEmail } from '../email';
import {
  bindSharedVerification,
  sharedClaim,
  hasSharedClaim,
  acceptSharedVerification,
} from '../membership';
import { invitationAuth } from './invitation';

export function authConfigured(env: Env): boolean {
  return Boolean(
    env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 && emailConfigured(env),
  );
}

export function authOptions(env: Env): BetterAuthOptions {
  const sharedVerifications = new WeakSet<Request>();
  async function isSharedVerification(
    token: string | null,
    request: Request | undefined,
  ) {
    if (!token || !request) return false;
    if (sharedVerifications.has(request)) return true;
    const shared = await hasSharedClaim(env.DB, token);
    // Keep the source from before token consumption through session issuance.
    // Cleanup can remove the claim in between; it must fail, not switch inviters.
    if (shared) sharedVerifications.add(request);
    return shared;
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
        ...invitationAuth(env),
        hooks: {
          before: [
            {
              matcher: (ctx) => ctx.path === '/magic-link/verify',
              handler: createAuthMiddleware(async (ctx) => {
                const token =
                  typeof ctx.query?.token === 'string' ? ctx.query.token : null;
                await isSharedVerification(token, ctx.request);
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
          const shared = metadata?.inviteLink;
          const eligible =
            existing ||
            (shared !== undefined
              ? await bindSharedVerification(env.DB, shared, email, token)
              : await canJoin(env.DB, email, env.BOOTSTRAP_EMAIL));
          if (!eligible)
            throw new APIError('FORBIDDEN', {
              code: 'INVITATION_REQUIRED',
              message: 'You need an invitation from a slowmass member to join.',
            });
          await sendLoginEmail(env, email, url);
        },
      }),
    ],
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false } },
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
            const shared = await isSharedVerification(token, ctx?.request);
            if (
              !user.emailVerified ||
              !(shared && token
                ? await sharedClaim(env.DB, token, user.email)
                : await canJoin(env.DB, user.email, env.BOOTSTRAP_EMAIL))
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'An invitation from an active member is required.',
              });
            }
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
            const shared = await isSharedVerification(token, ctx?.request);
            if (await activeMember(env.DB, session.userId))
              return { data: session };
            if (
              !(shared && token
                ? await acceptSharedVerification(env.DB, session.userId, token)
                : await ensureMembership(
                    env.DB,
                    session.userId,
                    env.BOOTSTRAP_EMAIL,
                  ))
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'An invitation from an active member is required.',
              });
            }
            return { data: session };
          },
        },
      },
    },
  };
}

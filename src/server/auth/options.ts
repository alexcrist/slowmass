import { resolveSignInEmail } from './email';
import {
  googleClaim,
  googleProvider,
  googleUserPolicy,
  signInPolicy,
} from './google';
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
import { SIGN_IN_LINK_SECONDS } from '../../shared/sign-in';

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
  const bootstrapEmail = () =>
    env.BOOTSTRAP_EMAIL
      ? resolveSignInEmail(env.DB, env.BOOTSTRAP_EMAIL)
      : undefined;
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
    socialProviders: googleProvider(env),
    user: { validateUserInfo: googleUserPolicy(env) },
    onAPIError: { errorURL: `${env.APP_ORIGIN}/?error=signin` },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    plugins: [
      signInPolicy(env),
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
        expiresIn: SIGN_IN_LINK_SECONDS,
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
                  : await canJoin(env.DB, email, await bootstrapEmail()));
          if (!eligible)
            throw new APIError('FORBIDDEN', {
              code: 'INVITATION_REQUIRED',
              message: 'Ask a slowmass member to text you an invite link.',
            });
          // Recovery must work in a different browser, even after the email
          // token/claim is consumed or cleaned up. Carry only the original
          // invitation in the error destination's fragment, never the email.
          // It is a navigation hint; resending rechecks current eligibility.
          const recovery = new URL('/?error=signin', env.APP_ORIGIN);
          const kind = metadata?.eventLink !== undefined ? 'event' : 'invite';
          const link = metadata?.eventLink ?? metadata?.inviteLink;
          if (typeof link === 'string' && /^[a-zA-Z0-9]{48}$/.test(link)) {
            recovery.searchParams.set('error', kind);
            recovery.hash = `${kind}/${link}`;
          }
          const verification = new URL(url);
          verification.searchParams.set(
            'errorCallbackURL',
            recovery.pathname + recovery.search + recovery.hash,
          );
          await sendLoginEmail(env, email, verification.href);
        },
      }),
    ],
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
      storeAccountCookie: false,
    },
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
      account: {
        create: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
            },
          }),
        },
        update: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
            },
          }),
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            const oauth =
              ctx?.path === '/callback/:id' ? await googleClaim() : null;
            const token =
              oauth?.token ??
              (ctx?.path === '/magic-link/verify' &&
              typeof ctx.query?.token === 'string'
                ? ctx.query.token
                : null);
            const source =
              oauth?.source ?? (await linkVerification(token, ctx?.request));
            if (
              !user.emailVerified ||
              !(source && token
                ? await (source === 'event' ? eventClaim : inviteClaim)(
                    env.DB,
                    token,
                    user.email,
                  )
                : await canJoin(env.DB, user.email, await bootstrapEmail()))
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
            const oauth =
              ctx?.path === '/callback/:id' ? await googleClaim() : null;
            const token =
              oauth?.token ??
              (ctx?.path === '/magic-link/verify' &&
              typeof ctx.query?.token === 'string'
                ? ctx.query.token
                : null);
            // Signing in through a link joins new people first; event links
            // also record the link for members.
            const source =
              oauth?.source ?? (await linkVerification(token, ctx?.request));
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
                await bootstrapEmail(),
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

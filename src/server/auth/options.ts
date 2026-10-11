import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import type { Env } from '../env';
import { canJoin, ensureMembership, activeMember } from '../membership';
import { emailConfigured, sendLoginEmail } from '../email';

export function authConfigured(env: Env): boolean {
  return Boolean(
    env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 && emailConfigured(env),
  );
}

export function authOptions(env: Env): BetterAuthOptions {
  return {
    appName: 'Slowmass',
    baseURL: env.APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: { enabled: false },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 3 },
        sendMagicLink: async ({ email, url }) => {
          const user = await env.DB.prepare(
            'SELECT id FROM user WHERE lower(email) = ?',
          )
            .bind(email.trim().toLowerCase())
            .first<{ id: string }>();
          const eligible =
            (user && (await activeMember(env.DB, user.id))) ||
            (await canJoin(env.DB, email, env.BOOTSTRAP_EMAIL));
          // Keep responses identical for unknown and eligible addresses.
          if (!eligible) return;
          await sendLoginEmail(env, email, url);
        },
      }),
    ],
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: env.APP_ORIGIN.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              !user.emailVerified ||
              !(await canJoin(env.DB, user.email, env.BOOTSTRAP_EMAIL))
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
          before: async (session) => {
            if (
              !(await ensureMembership(
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

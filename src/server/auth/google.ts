import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from 'better-auth/api';
import type { Env } from '../env';
import {
  canJoin,
  prepareOAuthClaim,
  identifyOAuthClaim,
  type OAuthClaim,
} from '../membership';
import { resolveSignInEmail } from './email';

export async function googleClaim(): Promise<OAuthClaim | null> {
  const state = await getOAuthState();
  const context = state?.serverContext;
  if (context?.slowmassGoogle !== true)
    throw new APIError('FORBIDDEN', { message: 'Start Google sign-in again.' });
  if (context.source === undefined && context.claim === undefined) return null;
  if (
    (context.source !== 'event' && context.source !== 'invite') ||
    typeof context.claim !== 'string'
  )
    throw new APIError('FORBIDDEN', { message: 'Invalid invitation context.' });
  return { source: context.source, token: context.claim };
}

export function googleProvider(env: Env): BetterAuthOptions['socialProviders'] {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return {};
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableDefaultScope: true,
      scope: ['openid', 'email'],
      includeGrantedScopes: false,
      accessType: 'online',
      prompt: 'select_account',
      overrideUserInfoOnSignIn: false,
      mapProfileToUser: async (profile) => ({
        email: await resolveSignInEmail(env.DB, profile.email),
        image: undefined,
        name: '',
      }),
    },
  };
}

export function signInPolicy(env: Env): BetterAuthPlugin {
  return {
    id: 'slowmass-sign-in-policy',
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            [
              '/sign-in/social',
              '/sign-in/magic-link',
              '/link-social',
              '/unlink-account',
              '/get-access-token',
              '/refresh-token',
            ].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path === '/sign-in/magic-link') {
              if (typeof ctx.body?.email === 'string')
                ctx.body.email = await resolveSignInEmail(
                  env.DB,
                  ctx.body.email,
                );
              return;
            }
            // Slowmass supports only the server redirect flow, with identity scopes.
            if (
              ctx.path !== '/sign-in/social' ||
              ctx.body?.provider !== 'google' ||
              ctx.body.idToken ||
              ctx.body.scopes ||
              ctx.body.additionalParams
            )
              throw new APIError('BAD_REQUEST', {
                message: 'Unsupported sign-in request.',
              });
            if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
              throw new APIError('SERVICE_UNAVAILABLE', {
                message: 'Google sign-in is not configured.',
              });
            const data = ctx.body.additionalData;
            const eventLink: unknown = data?.eventLink;
            const inviteLink: unknown = data?.inviteLink;
            if (eventLink !== undefined && inviteLink !== undefined)
              throw new APIError('BAD_REQUEST', {
                message: 'Use one invitation at a time.',
              });
            const source =
              eventLink !== undefined
                ? 'event'
                : inviteLink !== undefined
                  ? 'invite'
                  : null;
            const link = eventLink ?? inviteLink;
            const claim = source
              ? await prepareOAuthClaim(env.DB, source, link)
              : null;
            if (source && !claim)
              throw new APIError('FORBIDDEN', {
                code: 'INVITATION_REQUIRED',
                message: 'This invitation is no longer available.',
              });
            await addOAuthServerContext({
              slowmassGoogle: true,
              ...(claim ? { source: claim.source, claim: claim.token } : {}),
            });
            const destination = source ? `/#${source}/${link}` : '/';
            ctx.body.callbackURL = destination;
            ctx.body.newUserCallbackURL = destination;
            ctx.body.errorCallbackURL = source
              ? `/?auth=google#${source}/${link}`
              : '/?auth=google';
            // Do not carry client-supplied state fields across the redirect.
            ctx.body.additionalData = undefined;
          }),
        },
      ],
    },
  };
}

export function googleUserPolicy(
  env: Env,
): NonNullable<BetterAuthOptions['user']>['validateUserInfo'] {
  return async ({ user, source }) => {
    if (source.method !== 'oauth') return;
    const profile = source.oauth?.profile;
    // Google is authoritative for Gmail and managed Workspace emails. Other
    // Google accounts must use an email link to prove current mailbox control.
    if (
      source.oauth?.providerId !== 'google' ||
      profile?.email_verified !== true ||
      typeof profile.email !== 'string' ||
      (!/@(gmail|googlemail)\.com$/i.test(profile.email) &&
        !(typeof profile.hd === 'string' && profile.hd.length > 0))
    )
      return {
        error: 'USE_EMAIL_LINK',
        errorDescription: 'Use an email sign-in link for this address.',
      };
    if (typeof user.email !== 'string') return { error: 'EMAIL_REQUIRED' };
    if (source.action !== 'create-user') {
      const stored = await env.DB.prepare(
        'SELECT email,emailVerified FROM user WHERE id=?',
      )
        .bind(user.id)
        .first<{ email: string; emailVerified: number }>();
      if (!stored?.emailVerified || stored.email !== user.email)
        return { error: 'EMAIL_IDENTITY_CHANGED' };
    }
    const claim = await googleClaim();
    if (
      !claim &&
      source.action === 'create-user' &&
      !(await canJoin(
        env.DB,
        user.email,
        env.BOOTSTRAP_EMAIL
          ? await resolveSignInEmail(env.DB, env.BOOTSTRAP_EMAIL)
          : undefined,
      ))
    )
      return { error: 'INVITATION_REQUIRED' };
    if (claim && !(await identifyOAuthClaim(env.DB, claim, user.email)))
      return { error: 'INVITATION_REQUIRED' };
  };
}

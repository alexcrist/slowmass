import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { Env } from '../env';
import {
  acceptInvitationJoin,
  invitationJoin,
  sharedInvitation,
} from '../membership';

function readToken(body: unknown): string {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    typeof body.token !== 'string' ||
    !/^[a-zA-Z0-9]{48}$/.test(body.token)
  ) {
    throw new APIError('BAD_REQUEST', {
      code: 'INVALID_INVITATION',
      message: 'This invitation link is invalid.',
    });
  }
  return body.token;
}

// Better Auth owns identity creation, session generation, signing and cookies.
// Membership owns the invitation's expiry, revocation and atomic single use.
export function invitationAuth(env: Env): BetterAuthPlugin {
  return {
    id: 'invitation-join',
    endpoints: {
      previewSharedInvitation: createAuthEndpoint(
        '/shared-invitation/preview',
        { method: 'POST', requireHeaders: true },
        async (ctx) => {
          const invitation = await sharedInvitation(
            env.DB,
            readToken(ctx.body),
          );
          if (!invitation) return ctx.json({ status: 'unavailable' });
          const session = await getSessionFromCtx(ctx);
          return ctx.json({
            status: 'ready',
            expiresAt: invitation.expiresAt,
            inviter: { name: invitation.name, handle: invitation.handle },
            signedIn: Boolean(session),
          });
        },
      ),
      previewInvitation: createAuthEndpoint(
        '/invitation/preview',
        { method: 'POST', requireHeaders: true },
        async (ctx) => {
          const invitation = await invitationJoin(env.DB, readToken(ctx.body));
          if (invitation.status !== 'ready') return ctx.json(invitation);
          const session = await getSessionFromCtx(ctx);
          return ctx.json({
            status: 'ready' as const,
            email: invitation.email,
            expiresAt: invitation.expiresAt,
            inviter: { name: invitation.name, handle: invitation.handle },
            signedInAs: session?.user.email ?? null,
          });
        },
      ),
      acceptInvitation: createAuthEndpoint(
        '/invitation/accept',
        { method: 'POST', requireHeaders: true },
        async (ctx) => {
          const token = readToken(ctx.body);
          const invitation = await invitationJoin(env.DB, token);
          if (invitation.status !== 'ready') {
            throw new APIError('BAD_REQUEST', {
              code: 'INVITATION_UNAVAILABLE',
              message: 'This invitation can no longer be accepted.',
            });
          }
          if (await getSessionFromCtx(ctx)) {
            throw new APIError('CONFLICT', {
              code: 'SIGN_OUT_REQUIRED',
              message:
                'Sign out of your current account before accepting this invitation.',
            });
          }
          const adapter = ctx.context.internalAdapter;
          let user = (await adapter.findUserByEmail(invitation.email))?.user;
          if (!user) {
            try {
              user = await adapter.createUser(
                { email: invitation.email, emailVerified: true, name: '' },
                { method: 'invitation-join' },
              );
            } catch (error) {
              // A concurrent acceptance may have created the identity first. Only
              // the request that inserts membership below can issue a session.
              user = (await adapter.findUserByEmail(invitation.email))?.user;
              if (!user) throw error;
            }
          }
          if (
            !user.emailVerified ||
            !(await acceptInvitationJoin(env.DB, invitation.id, user.id, token))
          ) {
            throw new APIError('BAD_REQUEST', {
              code: 'INVITATION_UNAVAILABLE',
              message:
                'This invitation can no longer be accepted. Use email sign-in to continue.',
            });
          }
          const session = await adapter.createSession(user.id);
          if (!session)
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Account created. Use email sign-in to continue.',
            });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path) =>
          path.startsWith('/invitation/') ||
          path.startsWith('/shared-invitation/'),
        window: 60,
        max: 10,
      },
    ],
  };
}

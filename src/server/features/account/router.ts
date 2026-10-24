import { bodyLimit } from 'hono/body-limit';
import { deleteAccount } from './index';
import { Hono } from 'hono';
import { getActiveUser, renewActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import { ownProfile } from '../people';
import { deviceSetupPending } from '../device-setup';
import { hasPushSubscription } from '../push';

export const bootstrap = new Hono<{ Bindings: Env }>();
bootstrap.get('/', async (c) => {
  const signInAvailable = authConfigured(c.env);
  const { user, cookies, value } = signInAvailable
    ? await renewActiveUser(c.env, c.req.raw.headers, (id) =>
        Promise.all([
          ownProfile(c.env.DB, id),
          deviceSetupPending(c.env.DB, id),
          hasPushSubscription(c.env.DB, id),
        ]),
      )
    : { user: null, cookies: [], value: null };
  for (const cookie of cookies)
    c.header('Set-Cookie', cookie, { append: true });
  const [profile, pending, pushSubscribed] = value ?? [null, false, false];
  return c.json({
    signInAvailable,
    googleSignInAvailable: Boolean(
      signInAvailable && c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET,
    ),
    user,
    profile,
    deviceSetupPending: pending,
    pushSubscribed,
  });
});

export const account = new Hono<{ Bindings: Env }>();
account.get('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  return c.json({ user });
});

account.delete('/', bodyLimit({ maxSize: 256 }), async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  const body: unknown = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('confirmation' in body) ||
    body.confirmation !== 'DELETE'
  )
    return c.json({ error: 'Type DELETE to confirm account deletion.' }, 400);
  await deleteAccount(c.env.DB, user.id);
  return c.json({ ok: true });
});

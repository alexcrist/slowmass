import { bodyLimit } from 'hono/body-limit';
import { deleteAccount } from './index';
import { Hono } from 'hono';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';

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
    return c.json({ error: 'Sign in to continue.' }, 401);
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

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

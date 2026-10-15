import { Hono } from 'hono';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import { completeDeviceSetup, deviceSetupPending } from './index';

export const deviceSetup = new Hono<{ Bindings: Env }>();
deviceSetup.on(['GET', 'DELETE'], '/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  if (!session) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session.hasProfilePhoto)
    return c.json({ error: 'Add a profile photo first.' }, 409);
  if (c.req.method === 'DELETE')
    await completeDeviceSetup(c.env.DB, session.user.id);
  return c.json({
    pending: await deviceSetupPending(c.env.DB, session.user.id),
  });
});

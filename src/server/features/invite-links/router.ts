import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import { inviteLinkAdmits } from '../../membership';
import { inviteLink } from './index';

export const inviteLinks = new Hono<{ Bindings: Env }>();
inviteLinks.use(
  '*',
  bodyLimit({
    maxSize: 1024,
    onError: (c) => c.json({ error: 'Request is too large.' }, 413),
  }),
);

// Signed out, a link holder learns only whether the link admits new people.
inviteLinks.post('/check', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return c.json({ available: await inviteLinkAdmits(c.env.DB, body?.token) });
});

inviteLinks.post('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  if (!session) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  const link = await inviteLink(c.env, session.user.id);
  return link
    ? c.json(link)
    : c.json({ error: 'Could not get your invite link. Try again.' }, 409);
});

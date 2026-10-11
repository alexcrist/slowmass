import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import { issueInvitation } from '../../membership';
import type { Env } from '../../env';

export const invitations = new Hono<{ Bindings: Env }>();
invitations.use('*', bodyLimit({ maxSize: 1024 }));
invitations.post('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Enter a valid email address.' }, 400);
  }
  const email =
    typeof body === 'object' && body !== null && 'email' in body
      ? body.email
      : null;
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    return c.json({ error: 'Enter a valid email address.' }, 400);
  const invitation = await issueInvitation(c.env.DB, user.id, email);
  if (!invitation)
    return c.json(
      {
        error:
          'Invitation could not be created. It may already exist, or you may have reached your daily limit.',
      },
      409,
    );
  return c.json({ invitation }, 201);
});

export { inviteLink } from './link-router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import { createInvitation, invitationPage, cancelInvitation } from './index';
import type { Env } from '../../env';
import { deliverInvitation } from './delivery';

const deliveryErrors = {
  missing: ['Invitation is no longer available.', 404],
  pending: [
    'An email attempt is in progress. Wait a minute, then retry from your invitations.',
    409,
  ],
  limited: [
    'Email limit reached. Your invitation is saved; retry sending later.',
    429,
  ],
  failed: [
    'We could not confirm the email was sent. Your invitation is saved; retry sending in a minute.',
    503,
  ],
  expired: [
    'Email delivery could not be confirmed. Cancel this invitation and create a new one.',
    409,
  ],
} as const;

export const invitations = new Hono<{ Bindings: Env }>();
invitations.use('*', bodyLimit({ maxSize: 1024 }));
invitations.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  await next();
});
invitations.post('/', async (c) => {
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
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
  const { created, invitation } = await createInvitation(
    c.env.DB,
    user.id,
    email,
  );
  if (!invitation)
    return c.json(
      {
        error: 'Invitation could not be created for this email address.',
      },
      409,
    );
  const delivery = await deliverInvitation(c.env, user.id, invitation.id);
  if (delivery !== 'sent') {
    const [error, status] = deliveryErrors[delivery];
    return c.json({ error }, status);
  }
  return c.json({ invitation }, created ? 201 : 200);
});

invitations.post('/:id/send', async (c) => {
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  const delivery = await deliverInvitation(c.env, user.id, c.req.param('id'));
  if (delivery === 'sent') return c.json({ ok: true });
  const [error, status] = deliveryErrors[delivery];
  return c.json({ error }, status);
});

invitations.get('/', async (c) => {
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  const after = c.req.query('after') ?? '';
  if (after && !/^\d{1,16}:[a-zA-Z0-9-]{1,64}$/.test(after))
    return c.json({ error: 'Invalid page.' }, 400);
  const [time, id] = after.split(':');
  const now = Date.now();
  const before = time ? Number(time) : now + 1;
  if (!Number.isSafeInteger(before))
    return c.json({ error: 'Invalid page.' }, 400);
  return c.json(await invitationPage(c.env.DB, user.id, before, id ?? '', now));
});
invitations.delete('/:id', async (c) => {
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  await cancelInvitation(c.env.DB, user.id, c.req.param('id'));
  return c.json({ ok: true });
});

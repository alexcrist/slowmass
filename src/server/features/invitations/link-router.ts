import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import {
  currentInviteLink,
  ensureInviteLink,
  replaceInviteLink,
} from './links';

export const inviteLink = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
inviteLink.use(
  '*',
  bodyLimit({
    maxSize: 1024,
    onError: (c) => c.json({ error: 'Request is too large.' }, 413),
  }),
);
inviteLink.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  c.set('userId', user.id);
  await next();
});
function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  );
}
inviteLink.get('/', async (c) =>
  c.json({ link: await currentInviteLink(c.env.DB, c.get('userId')) }),
);
inviteLink.post('/copy', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('id' in body) ||
    !validId(body.id) ||
    Object.keys(body).some((key) => key !== 'id')
  )
    return c.json(
      { error: 'Reload slowmass and try copying the link again.' },
      400,
    );
  const link = await ensureInviteLink(c.env, c.get('userId'), body.id);
  return link
    ? c.json(link)
    : c.json(
        {
          error:
            'Could not copy this invite link. Try again, or replace it in Link options.',
        },
        409,
      );
});
inviteLink.post('/replace', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('id' in body) ||
    !validId(body.id) ||
    !('expectedId' in body) ||
    !validId(body.expectedId) ||
    body.id === body.expectedId ||
    Object.keys(body).some((key) => key !== 'id' && key !== 'expectedId')
  )
    return c.json(
      { error: 'Reload slowmass and try replacing the link again.' },
      400,
    );
  const link = await replaceInviteLink(
    c.env,
    c.get('userId'),
    body.id,
    body.expectedId,
  );
  return link
    ? c.json(link)
    : c.json(
        { error: 'Your invite link changed. Close this dialog and try again.' },
        409,
      );
});

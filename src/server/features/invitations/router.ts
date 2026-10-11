import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import { issueInvitation } from '../../membership';
import type { Env } from '../../env';

export const invitations = new Hono<{ Bindings: Env }>();
invitations.use('*', bodyLimit({ maxSize: 1024 }));
invitations.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  await next();
});
invitations.post('/', async (c) => {
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

invitations.get('/', async (c) => {
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  const after = c.req.query('after') ?? '';
  if (after && !/^\d{1,16}:[a-zA-Z0-9-]{1,64}$/.test(after))
    return c.json({ error: 'Invalid page.' }, 400);
  const [time, id] = after.split(':');
  const now = Date.now();
  const before = time ? Number(time) : now + 1;
  if (!Number.isSafeInteger(before))
    return c.json({ error: 'Invalid page.' }, 400);
  const result = await c.env.DB.prepare(
    `SELECT id,recipient_email AS email,created_at AS createdAt,expires_at AS expiresAt,accepted_by AS acceptedBy,revoked_at AS revokedAt FROM invitation WHERE inviter_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21`,
  )
    .bind(user.id, before, before, id ?? '')
    .all<{
      id: string;
      email: string;
      createdAt: number;
      expiresAt: number;
      acceptedBy: string | null;
      revokedAt: number | null;
    }>();
  const items = result.results.slice(0, 20).map(({ acceptedBy, ...item }) => ({
    ...item,
    accepted: Boolean(acceptedBy),
    expired: item.expiresAt <= now,
  }));
  const last = items.at(-1);
  return c.json({
    items,
    next:
      result.results.length > 20 && last
        ? `${last.createdAt}:${last.id}`
        : null,
  });
});
invitations.delete('/:id', async (c) => {
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  await c.env.DB.prepare(
    'UPDATE invitation SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND inviter_id=? AND accepted_by IS NULL',
  )
    .bind(Date.now(), c.req.param('id'), user.id)
    .run();
  return c.json({ ok: true });
});

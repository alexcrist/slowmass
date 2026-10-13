import { Hono } from 'hono';
import { measuredObjectRead } from '../../telemetry';
import type { Env } from '../../env';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import { ownProfile } from '../people';
import { PhotoError } from '../../photos';
import { saveAvatar, findAvatar } from './index';
export const avatars = new Hono<{ Bindings: Env }>();
export const avatarMedia = new Hono<{ Bindings: Env }>();

avatars.put('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!(await ownProfile(c.env.DB, user.id)))
    return c.json({ error: 'Create your profile first.' }, 409);
  if (!c.env.IMAGES)
    return c.json({ error: 'Photo processing is unavailable.' }, 503);
  const id = c.req.header('Idempotency-Key') ?? '';
  if (!/^[a-f0-9-]{36}$/.test(id))
    return c.json({ error: 'A valid upload ID is required.' }, 400);
  try {
    const state = await saveAvatar(c.env, user.id, id, c.req.raw);
    if (state === 'done') return c.json({ ok: true });
    if (state === 'quota')
      return c.json(
        { error: 'Photo upload limit reached. Try again later.' },
        429,
      );
    if (state === 'inactive')
      return c.json({ error: 'Account is no longer active.' }, 403);
    return c.json(
      {
        error:
          'This upload is in progress or failed. Wait before retrying, or choose the file again to start a new upload.',
      },
      409,
    );
  } catch (error) {
    if (error instanceof PhotoError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});
avatars.delete('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  return c.json(
    { error: 'A profile photo is required. Upload a replacement instead.' },
    409,
  );
});
avatarMedia.get('/:handle', async (c) => {
  const size = c.req.query('size');
  if (size !== undefined && size !== 'large') return c.notFound();
  if (!authConfigured(c.env)) return c.notFound();
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.notFound();
  const avatar = await findAvatar(
    c.env.DB,
    user.id,
    c.req.param('handle').toLowerCase(),
  );
  if (!avatar) return c.notFound();
  const object = await measuredObjectRead(
    c.env.PHOTOS,
    size === 'large'
      ? (avatar.large_key ?? avatar.object_key)
      : avatar.object_key,
  );
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

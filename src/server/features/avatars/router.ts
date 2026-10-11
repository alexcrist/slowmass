import { Hono } from 'hono';
import type { Env } from '../../env';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import { findProfile, ownProfile } from '../people';
import { processPhoto, PhotoError } from '../../photos';
import { readPhoto, reservePhoto, reserveStorage } from '../../photos/storage';
export const avatars = new Hono<{ Bindings: Env }>();
export const avatarMedia = new Hono<{ Bindings: Env }>();

avatars.put('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign in to continue.' }, 401);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (!(await ownProfile(c.env.DB, user.id)))
    return c.json({ error: 'Create your profile first.' }, 409);
  if (!c.env.IMAGES)
    return c.json({ error: 'Photo processing is unavailable.' }, 503);
  const id = c.req.header('Idempotency-Key') ?? '';
  if (!/^[a-f0-9-]{36}$/.test(id))
    return c.json({ error: 'A valid upload ID is required.' }, 400);
  const state = await reservePhoto(c.env.DB, user.id, id);
  if (state === 'done') return c.json({ ok: true });
  if (state === 'quota')
    return c.json(
      { error: 'Photo upload limit reached. Try again later.' },
      429,
    );
  if (state !== 'reserved')
    return c.json(
      {
        error:
          'This upload is in progress or failed. Wait before retrying, or choose the file again to start a new upload.',
      },
      409,
    );
  const key = `avatars/${crypto.randomUUID()}.webp`;
  await c.env.DB.prepare(
    'INSERT INTO photo_cleanup (object_key,not_before) VALUES (?,?)',
  )
    .bind(key, Date.now() + 3600000)
    .run();
  try {
    const photo = await processPhoto(
      c.env.IMAGES,
      await readPhoto(c.req.raw),
      320,
    );
    await reserveStorage(c.env.DB, user.id, key, photo.bytes.length);
    await c.env.PHOTOS.put(key, photo.bytes, {
      httpMetadata: { contentType: 'image/webp' },
    });
    const published = await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO photo_cleanup (object_key,not_before) SELECT object_key,? FROM avatar WHERE user_id=? ON CONFLICT DO NOTHING',
      ).bind(Date.now(), user.id),
      c.env.DB.prepare(
        `INSERT INTO avatar (user_id,object_key,width,height) SELECT user_id,?,?,? FROM membership WHERE user_id=? AND status='active' ON CONFLICT(user_id) DO UPDATE SET object_key=excluded.object_key,width=excluded.width,height=excluded.height`,
      ).bind(key, photo.width, photo.height, user.id),
      c.env.DB.prepare(
        "UPDATE photo_attempt SET state='done' WHERE id=? AND EXISTS(SELECT 1 FROM avatar WHERE object_key=?)",
      ).bind(`${user.id}:${id}`, key),
      c.env.DB.prepare(
        'DELETE FROM photo_cleanup WHERE object_key=? AND EXISTS(SELECT 1 FROM avatar WHERE object_key=?)',
      ).bind(key, key),
    ]);
    if (!published[1].meta.changes)
      return c.json({ error: 'Account is no longer active.' }, 403);
    return c.json({ ok: true });
  } catch (error) {
    await c.env.DB.prepare("UPDATE photo_attempt SET state='failed' WHERE id=?")
      .bind(`${user.id}:${id}`)
      .run();
    if (error instanceof PhotoError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});
avatars.delete('/', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign in to continue.' }, 401);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO photo_cleanup (object_key,not_before) SELECT object_key,? FROM avatar WHERE user_id=? ON CONFLICT DO NOTHING',
    ).bind(Date.now(), user.id),
    c.env.DB.prepare('DELETE FROM avatar WHERE user_id=?').bind(user.id),
  ]);
  return c.json({ ok: true });
});
avatarMedia.get('/:handle', async (c) => {
  if (!authConfigured(c.env)) return c.notFound();
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.notFound();
  const profile = await findProfile(
    c.env.DB,
    user.id,
    c.req.param('handle').toLowerCase(),
  );
  if (!profile || profile.bio === null) return c.notFound();
  const avatar = await c.env.DB.prepare(
    'SELECT object_key FROM avatar WHERE user_id=?',
  )
    .bind(profile.id)
    .first<{ object_key: string }>();
  if (!avatar) return c.notFound();
  const object = await c.env.PHOTOS.get(avatar.object_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

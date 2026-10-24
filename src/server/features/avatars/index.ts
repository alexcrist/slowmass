import { findProfile } from '../people';
export { cleanupAvatars } from './cleanup';
import type { Env } from '../../env';
import { processPhoto, PhotoError } from '../../photos';
import { readPhoto, reservePhoto, reserveStorage } from '../../photos/storage';

export async function saveAvatar(
  env: Env,
  userId: string,
  id: string,
  request: Request,
) {
  if (!env.IMAGES)
    throw new PhotoError('Photo processing is unavailable.', 503);
  const state = await reservePhoto(env.DB, userId, id, 2);
  if (state !== 'reserved') return state;
  try {
    const large = await processPhoto(env.IMAGES, await readPhoto(request));
    const small =
      large.width <= 320 && large.height <= 320
        ? large
        : await processPhoto(env.IMAGES, large.bytes, 320);
    const largeKey = `avatars/${crypto.randomUUID()}.webp`;
    const smallKey =
      small === large ? largeKey : `avatars/${crypto.randomUUID()}.webp`;
    // Each storage reservation records cleanup intent before R2 can receive bytes.
    await reserveStorage(env.DB, userId, largeKey, large.bytes.length);
    await env.PHOTOS.put(largeKey, large.bytes, {
      httpMetadata: { contentType: 'image/webp' },
    });
    if (smallKey !== largeKey) {
      await reserveStorage(env.DB, userId, smallKey, small.bytes.length);
      await env.PHOTOS.put(smallKey, small.bytes, {
        httpMetadata: { contentType: 'image/webp' },
      });
    }
    const published = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO photo_cleanup (object_key,not_before) SELECT object_key,? FROM avatar WHERE user_id=? ON CONFLICT DO NOTHING',
      ).bind(Date.now(), userId),
      env.DB.prepare(
        'INSERT INTO photo_cleanup (object_key,not_before) SELECT large_key,? FROM avatar WHERE user_id=? AND large_key IS NOT NULL ON CONFLICT DO NOTHING',
      ).bind(Date.now(), userId),
      env.DB.prepare(
        `INSERT INTO avatar (user_id,object_key,large_key,width,height) SELECT user_id,?,?,?,? FROM membership WHERE user_id=? AND status='active' ON CONFLICT(user_id) DO UPDATE SET object_key=excluded.object_key,large_key=excluded.large_key,width=excluded.width,height=excluded.height`,
      ).bind(smallKey, largeKey, small.width, small.height, userId),
      env.DB.prepare(
        "UPDATE photo_attempt SET state=CASE WHEN EXISTS(SELECT 1 FROM avatar WHERE object_key=? AND large_key=?) THEN 'done' ELSE 'failed' END WHERE id=?",
      ).bind(smallKey, largeKey, `${userId}:${id}`),
      env.DB.prepare(
        'DELETE FROM photo_cleanup WHERE object_key IN (?,?) AND EXISTS(SELECT 1 FROM avatar WHERE object_key=? AND large_key=?)',
      ).bind(smallKey, largeKey, smallKey, largeKey),
    ]);
    return published[2].meta.changes ? 'done' : 'inactive';
  } catch (error) {
    await env.DB.prepare(
      "UPDATE photo_attempt SET state='failed' WHERE id=? AND state='pending'",
    )
      .bind(`${userId}:${id}`)
      .run();
    throw error;
  }
}

export async function findAvatar(
  db: D1Database,
  actor: string,
  handle: string,
) {
  // Read the keys alongside the visibility check; they are only returned when
  // the profile is visible and belongs to the same account.
  const [profile, avatar] = await Promise.all([
    findProfile(db, actor, handle),
    db
      .prepare(
        'SELECT a.user_id,a.object_key,a.large_key FROM avatar a JOIN profile p ON p.user_id=a.user_id WHERE p.handle=?',
      )
      .bind(handle)
      .first<{
        user_id: string;
        object_key: string;
        large_key: string | null;
      }>(),
  ]);
  if (!profile || avatar?.user_id !== profile.id) return null;
  return { object_key: avatar.object_key, large_key: avatar.large_key };
}

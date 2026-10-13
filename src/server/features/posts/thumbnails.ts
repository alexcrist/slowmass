import type { Env } from '../../env';
import { processPhoto } from '../../photos';
import { reservePhoto, reserveStorage } from '../../photos/storage';

// One legacy post per scheduled pass. The unique attempt prevents overlapping
// schedules from processing the same post or repeatedly billing a failed image.
export async function backfillThumbnail(env: Env) {
  if (!env.IMAGES) return;
  const post = await env.DB.prepare(
    `SELECT p.id,p.user_id,p.object_key,p.width,p.height FROM post p
     JOIN membership m ON m.user_id=p.user_id AND m.status='active'
     WHERE p.state='published' AND p.thumbnail_key IS NULL
     AND NOT EXISTS(SELECT 1 FROM photo_attempt WHERE id=p.user_id||':thumbnail/'||p.id)
     ORDER BY p.published_at,p.id LIMIT 1`,
  ).first<{
    id: string;
    user_id: string;
    object_key: string;
    width: number;
    height: number;
  }>();
  if (!post) return;
  const attempt = `thumbnail/${post.id}`;
  if ((await reservePhoto(env.DB, post.user_id, attempt)) !== 'reserved')
    return;
  let key = post.object_key;
  try {
    if (post.width > 480 || post.height > 480) {
      const original = await env.PHOTOS.get(post.object_key);
      if (!original) throw new Error('Missing processed photo');
      const photo = await processPhoto(
        env.IMAGES,
        new Uint8Array(await original.arrayBuffer()),
        480,
      );
      key = `posts/${crypto.randomUUID()}.webp`;
      await reserveStorage(env.DB, post.user_id, key, photo.bytes.length);
      await env.PHOTOS.put(key, photo.bytes, {
        httpMetadata: { contentType: 'image/webp' },
      });
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE post SET thumbnail_key=? WHERE id=? AND state='published' AND object_key=? AND thumbnail_key IS NULL
        AND EXISTS(SELECT 1 FROM membership WHERE user_id=post.user_id AND status='active')`,
      ).bind(key, post.id, post.object_key),
      env.DB.prepare(
        `UPDATE photo_attempt SET state=CASE WHEN EXISTS(SELECT 1 FROM post WHERE id=? AND state='published' AND thumbnail_key=?) THEN 'done' ELSE 'failed' END WHERE id=?`,
      ).bind(post.id, key, `${post.user_id}:${attempt}`),
      env.DB.prepare(
        `DELETE FROM photo_cleanup WHERE object_key=? AND EXISTS(SELECT 1 FROM post WHERE id=? AND state='published' AND thumbnail_key=?)`,
      ).bind(key, post.id, key),
    ]);
  } catch {
    await env.DB.prepare("UPDATE photo_attempt SET state='failed' WHERE id=?")
      .bind(`${post.user_id}:${attempt}`)
      .run();
    console.error(JSON.stringify({ event: 'thumbnail.backfill_failed' }));
  }
}

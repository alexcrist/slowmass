export { backfillThumbnail } from './thumbnails';
import type { Env } from '../../env';
import { PhotoError, processPhoto } from '../../photos';
import {
  readPhoto,
  photoReservation,
  reserveStorage,
  releaseStorage,
} from '../../photos/storage';
export type Draft = { id: string; caption: string; altText: string };
export function parseDraft(value: unknown): Draft | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      input.id,
    ) ||
    typeof input.caption !== 'string' ||
    input.caption.length > 2000 ||
    typeof input.altText !== 'string' ||
    input.altText.length > 500
  )
    return null;
  return {
    id: input.id,
    caption: input.caption.trim(),
    altText: input.altText.trim(),
  };
}
export async function createDraft(db: D1Database, actor: string, draft: Draft) {
  const prior = await db
    .prepare('SELECT user_id,state,caption,alt_text FROM post WHERE id=?')
    .bind(draft.id)
    .first<{
      user_id: string;
      state: string;
      caption: string;
      alt_text: string;
    }>();
  if (prior)
    return prior.user_id === actor &&
      prior.caption === draft.caption &&
      prior.alt_text === draft.altText
      ? prior.state
      : 'conflict';
  await db.batch([
    photoReservation(db, actor, `post/${draft.id}`, 2),
    db
      .prepare(
        `INSERT INTO post(id,user_id,caption,alt_text,created_at,state)
       SELECT ?,user_id,?,?,?,'pending' FROM membership
       WHERE user_id=? AND status='active' AND EXISTS (
         SELECT 1 FROM photo_attempt WHERE id=? AND user_id=membership.user_id
         AND state='pending' AND processing_units=2
       ) ON CONFLICT DO NOTHING`,
      )
      .bind(
        draft.id,
        draft.caption,
        draft.altText,
        Date.now(),
        actor,
        `${actor}:post/${draft.id}`,
      ),
    // A concurrent claim of the same UUID by another owner must not leave an
    // allowance reservation for a draft we could not create.
    db
      .prepare(
        `DELETE FROM photo_attempt WHERE id=? AND state='pending'
      AND EXISTS(SELECT 1 FROM post WHERE id=? AND user_id!=?)`,
      )
      .bind(`${actor}:post/${draft.id}`, draft.id, actor),
  ]);
  // Read the winning write: concurrent equal requests succeed, different payloads
  // conflict. Existing pending reservations from interrupted older clients resume.
  const saved = await db
    .prepare('SELECT user_id,state,caption,alt_text FROM post WHERE id=?')
    .bind(draft.id)
    .first<{
      user_id: string;
      state: string;
      caption: string;
      alt_text: string;
    }>();
  if (saved)
    return saved.user_id === actor &&
      saved.caption === draft.caption &&
      saved.alt_text === draft.altText
      ? saved.state
      : 'conflict';
  const reservation = await db
    .prepare('SELECT 1 FROM photo_attempt WHERE id=?')
    .bind(`${actor}:post/${draft.id}`)
    .first();
  return reservation ? 'conflict' : 'quota';
}
export async function publishPhoto(
  env: Env,
  actor: string,
  id: string,
  request: Request,
) {
  const post = await env.DB.prepare(
    'SELECT state FROM post WHERE id=? AND user_id=?',
  )
    .bind(id, actor)
    .first<{ state: string }>();
  if (!post) return 'missing';
  if (post.state === 'published') return 'published';
  if (!env.IMAGES)
    throw new PhotoError('Photo processing is unavailable.', 503);
  const claimed = await env.DB.prepare(
    "UPDATE post SET state='processing' WHERE id=? AND user_id=? AND state='pending'",
  )
    .bind(id, actor)
    .run();
  if (!claimed.meta.changes) return 'conflict';
  const key = `posts/${crypto.randomUUID()}.webp`;
  try {
    await env.DB.prepare(
      'INSERT INTO photo_cleanup(object_key,not_before) VALUES(?,?)',
    )
      .bind(key, Date.now() + 3600000)
      .run();
    const photo = await processPhoto(env.IMAGES, await readPhoto(request));
    const thumbnail =
      photo.width <= 480 && photo.height <= 480
        ? photo
        : await processPhoto(env.IMAGES, photo.bytes, 480);
    const thumbnailKey =
      thumbnail === photo ? key : `posts/${crypto.randomUUID()}.webp`;
    await reserveStorage(env.DB, actor, key, photo.bytes.length);
    await env.PHOTOS.put(key, photo.bytes, {
      httpMetadata: { contentType: 'image/webp' },
    });
    if (thumbnailKey !== key) {
      await reserveStorage(env.DB, actor, thumbnailKey, thumbnail.bytes.length);
      await env.PHOTOS.put(thumbnailKey, thumbnail.bytes, {
        httpMetadata: { contentType: 'image/webp' },
      });
    }
    const results = await env.DB.batch([
      // Monotonic publication time makes snapshots stable even for same-millisecond writes.
      env.DB.prepare(
        `UPDATE post SET state='published',object_key=?,thumbnail_key=?,width=?,height=?,published_at=MAX(?,COALESCE((SELECT MAX(published_at)+1 FROM post),0)) WHERE id=? AND user_id=? AND state='processing' AND EXISTS(SELECT 1 FROM membership WHERE user_id=post.user_id AND status='active')`,
      ).bind(
        key,
        thumbnailKey,
        photo.width,
        photo.height,
        Date.now(),
        id,
        actor,
      ),
      env.DB.prepare(
        "UPDATE photo_attempt SET state='done' WHERE id=? AND EXISTS(SELECT 1 FROM post WHERE id=? AND state='published')",
      ).bind(`${actor}:post/${id}`, id),
      env.DB.prepare(
        "DELETE FROM photo_cleanup WHERE object_key IN (?,?) AND EXISTS(SELECT 1 FROM post WHERE id=? AND state='published' AND object_key=? AND thumbnail_key=?)",
      ).bind(key, thumbnailKey, id, key, thumbnailKey),
    ]);
    return results[0].meta.changes ? 'published' : 'conflict';
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE post SET state='failed' WHERE id=? AND state='processing'",
      ).bind(id),
      env.DB.prepare(
        "UPDATE photo_attempt SET state='failed' WHERE id=? AND state='pending'",
      ).bind(`${actor}:post/${id}`),
    ]);
    throw error;
  }
}
// All counts use current membership and block visibility in the same page query.
const visibility = `m.status='active' AND NOT EXISTS(SELECT 1 FROM block b WHERE (b.blocker_id=v.id AND b.target_id=p.user_id) OR (b.blocker_id=p.user_id AND b.target_id=v.id)) AND (p.user_id=v.id OR f.status='accepted')`;
const countColumns = ` (SELECT COUNT(*) FROM post_like l JOIN membership lm ON lm.user_id=l.user_id AND lm.status='active' WHERE l.post_id=p.id AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=v.id AND target_id=l.user_id) OR (blocker_id=l.user_id AND target_id=v.id))) AS likeCount,
 EXISTS(SELECT 1 FROM post_like WHERE post_id=p.id AND user_id=v.id) AS liked,
 (SELECT COUNT(*) FROM comment c JOIN membership cm ON cm.user_id=c.user_id AND cm.status='active' WHERE c.post_id=p.id AND c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=v.id AND target_id=c.user_id) OR (blocker_id=c.user_id AND target_id=v.id))) AS commentCount`;
const columns = (
  includeCounts = true,
) => `p.id,p.caption,p.alt_text AS altText,p.width,p.height,p.published_at AS publishedAt,p.state,p.object_key AS objectKey,p.thumbnail_key AS thumbnailKey,profile.handle,profile.display_name AS displayName,p.user_id AS ownerId,
 ${includeCounts ? countColumns : '0 AS likeCount,0 AS liked,0 AS commentCount'}`;
const joins = `CROSS JOIN viewer v JOIN profile ON profile.user_id=p.user_id JOIN membership m ON m.user_id=p.user_id LEFT JOIN follow f ON f.target_id=p.user_id AND f.follower_id=v.id`;
const select = (includeCounts = true) =>
  `WITH viewer AS (SELECT ? AS id) SELECT ${columns(includeCounts)} FROM post p ${joins}`;
export type PostRow = {
  id: string;
  caption: string;
  altText: string;
  width: number | null;
  height: number | null;
  publishedAt: number | null;
  state: string;
  objectKey: string | null;
  thumbnailKey: string | null;
  handle: string;
  displayName: string;
  ownerId: string;
  likeCount: number;
  commentCount: number;
  liked: number;
};
export function publicPost(row: PostRow, actor: string) {
  const { objectKey, thumbnailKey, ownerId, ...post } = row;
  void objectKey;
  return {
    ...post,
    isOwner: ownerId === actor,
    mediaUrl: row.state === 'published' ? `/media/posts/${row.id}` : null,
    thumbnailUrl:
      row.state === 'published'
        ? `/media/posts/${row.id}${thumbnailKey ? '?size=grid' : ''}`
        : null,
  };
}
export async function findPost(
  db: D1Database,
  actor: string,
  id: string,
  includeCounts = true,
) {
  return db
    .prepare(
      `${select(includeCounts)} WHERE p.id=? AND p.state!='deleted' AND (p.state='published' OR p.user_id=v.id) AND ${visibility}`,
    )
    .bind(actor, id)
    .first<PostRow>();
}
type Cursor = { snapshot: number; before: number; id: string };
export function parseCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > 400) throw new Error('Invalid page.');
  try {
    const cursor = JSON.parse(atob(value)) as Cursor;
    if (
      !Number.isSafeInteger(cursor.snapshot) ||
      !Number.isSafeInteger(cursor.before) ||
      cursor.snapshot < 0 ||
      cursor.before < 0 ||
      cursor.before > cursor.snapshot ||
      typeof cursor.id !== 'string' ||
      cursor.id.length > 36
    )
      throw new Error();
    return cursor;
  } catch {
    throw new Error('Invalid page.');
  }
}
export async function listPosts(
  db: D1Database,
  actor: string,
  handle: string | null,
  cursor: Cursor | null,
) {
  const snapshot =
    cursor?.snapshot ??
    (await db
      .prepare('SELECT COALESCE(MAX(published_at),0) AS value FROM post')
      .first<{ value: number }>())!.value;
  const before = cursor?.before ?? snapshot + 1;
  // Materialize IDs before hydration/counts. Starting from the viewer keeps the
  // follow lookup indexed; each author contributes at most one page of candidates.
  const eligible = handle
    ? `SELECT user_id AS target_id FROM profile WHERE handle=?`
    : `SELECT id AS target_id FROM viewer UNION ALL
       SELECT f.target_id FROM viewer v CROSS JOIN follow f
       JOIN membership m ON m.user_id=f.target_id AND m.status='active'
       WHERE f.follower_id=v.id AND f.status='accepted'
       AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=v.id AND target_id=f.target_id) OR (blocker_id=f.target_id AND target_id=v.id))`;
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id), eligible AS MATERIALIZED (${eligible}),
       candidates AS MATERIALIZED (
         SELECT p.id,p.published_at FROM eligible e CROSS JOIN post p
         WHERE p.id IN (
           SELECT recent.id FROM post recent WHERE recent.user_id=e.target_id AND recent.state='published'
           AND recent.published_at<=? AND (recent.published_at,recent.id)<(?,?)
           ORDER BY recent.published_at DESC,recent.id DESC LIMIT 13
         )
       ), page AS MATERIALIZED (
         SELECT id FROM candidates ORDER BY published_at DESC,id DESC LIMIT 13
       )
       SELECT ${columns()} FROM page chosen CROSS JOIN post p ON p.id=chosen.id ${joins}
       WHERE p.state='published' AND ${visibility}
       ORDER BY p.published_at DESC,p.id DESC`,
    )
    .bind(
      actor,
      ...(handle ? [handle] : []),
      Math.min(snapshot, before),
      before,
      cursor?.id ?? '',
    )
    .all<PostRow>();
  const items = rows.results.slice(0, 12);
  const last = items.at(-1);
  return {
    items: items.map((row) => publicPost(row, actor)),
    next:
      rows.results.length > 12 && last
        ? btoa(
            JSON.stringify({ snapshot, before: last.publishedAt, id: last.id }),
          )
        : null,
  };
}
export function parseCaption(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 &&
    typeof input.caption === 'string' &&
    input.caption.length <= 2000
    ? input.caption.trim()
    : null;
}
export async function editCaption(
  db: D1Database,
  actor: string,
  id: string,
  caption: string,
) {
  const result = await db
    .prepare(
      `UPDATE post SET caption=? WHERE id=? AND user_id=? AND state='published'
     AND EXISTS(SELECT 1 FROM membership WHERE user_id=post.user_id AND status='active')`,
    )
    .bind(caption, id, actor)
    .run();
  return Boolean(result.meta.changes);
}
export async function deletePost(db: D1Database, actor: string, id: string) {
  const result = await db.batch([
    db
      .prepare(
        'INSERT INTO photo_cleanup(object_key,not_before) SELECT object_key,? FROM post WHERE id=? AND user_id=? AND object_key IS NOT NULL ON CONFLICT DO NOTHING',
      )
      .bind(Date.now(), id, actor),
    db
      .prepare(
        'INSERT INTO photo_cleanup(object_key,not_before) SELECT thumbnail_key,? FROM post WHERE id=? AND user_id=? AND thumbnail_key IS NOT NULL ON CONFLICT DO NOTHING',
      )
      .bind(Date.now(), id, actor),
    db
      .prepare(
        "UPDATE post SET state='deleted',object_key=NULL,thumbnail_key=NULL,caption='',alt_text='' WHERE id=? AND user_id=?",
      )
      .bind(id, actor),
  ]);
  return Boolean(result[2].meta.changes);
}
export async function cleanupPosts(db: D1Database, bucket: R2Bucket) {
  const now = Date.now();
  const due = await db
    .prepare(
      "SELECT object_key FROM photo_cleanup WHERE object_key LIKE 'posts/%' AND not_before<=? ORDER BY not_before LIMIT 2",
    )
    .bind(now)
    .all<{ object_key: string }>();
  for (const row of due.results) {
    if (
      await db
        .prepare('SELECT 1 FROM post WHERE object_key=? OR thumbnail_key=?')
        .bind(row.object_key, row.object_key)
        .first()
    )
      continue;
    try {
      await bucket.delete(row.object_key);
      await releaseStorage(db, row.object_key);
      await db
        .prepare('DELETE FROM photo_cleanup WHERE object_key=?')
        .bind(row.object_key)
        .run();
    } catch {
      /* Retry on next scheduled pass. */
    }
  }
  await db
    .prepare(
      "UPDATE post SET state='failed' WHERE id IN(SELECT id FROM post WHERE state IN('pending','processing') AND created_at<? LIMIT 50)",
    )
    .bind(now - 3600000)
    .run();
}

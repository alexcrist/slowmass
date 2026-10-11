// Single-statement authorization prevents likes/comments racing with revocation.
const writablePost = `SELECT p.id FROM post p
 JOIN membership owner ON owner.user_id=p.user_id AND owner.status='active'
 JOIN membership viewer ON viewer.user_id=? AND viewer.status='active'
 WHERE p.id=? AND p.state='published'
 AND (p.user_id=viewer.user_id OR EXISTS(SELECT 1 FROM follow WHERE follower_id=viewer.user_id AND target_id=p.user_id AND status='accepted'))
 AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=viewer.user_id AND target_id=p.user_id) OR (blocker_id=p.user_id AND target_id=viewer.user_id))`;
export async function setLike(
  db: D1Database,
  actor: string,
  postId: string,
  liked: boolean,
) {
  if (!liked) {
    await db
      .prepare('DELETE FROM post_like WHERE post_id=? AND user_id=?')
      .bind(postId, actor)
      .run();
    return true;
  }
  await db
    .prepare(
      `INSERT INTO post_like(post_id,user_id,created_at) SELECT id,?,? FROM (${writablePost}) WHERE true ON CONFLICT DO NOTHING`,
    )
    .bind(actor, Date.now(), actor, postId)
    .run();
  return Boolean(
    await db
      .prepare('SELECT 1 FROM post_like WHERE post_id=? AND user_id=?')
      .bind(postId, actor)
      .first(),
  );
}
export async function addComment(
  db: D1Database,
  actor: string,
  postId: string,
  id: string,
  body: string,
) {
  const prior = await db
    .prepare('SELECT user_id,post_id,body,deleted_at FROM comment WHERE id=?')
    .bind(id)
    .first<{
      user_id: string;
      post_id: string;
      body: string;
      deleted_at: number | null;
    }>();
  if (prior)
    return (
      prior.user_id === actor &&
      prior.post_id === postId &&
      prior.deleted_at === null &&
      prior.body === body
    );
  const result = await db
    .prepare(
      `INSERT INTO comment(id,post_id,user_id,body,created_at)
 SELECT ?,id,?,?,? FROM (${writablePost})
 WHERE EXISTS(SELECT 1 FROM profile WHERE user_id=?)
 AND (SELECT COUNT(*) FROM comment WHERE user_id=? AND created_at>?)<100
 ON CONFLICT DO NOTHING`,
    )
    .bind(
      id,
      actor,
      body,
      Date.now(),
      actor,
      postId,
      actor,
      actor,
      Date.now() - 86400000,
    )
    .run();
  if (result.meta.changes) return true;
  return Boolean(
    await db
      .prepare(
        'SELECT 1 FROM comment WHERE id=? AND post_id=? AND user_id=? AND body=? AND deleted_at IS NULL',
      )
      .bind(id, postId, actor, body)
      .first(),
  );
}
export async function removeComment(db: D1Database, actor: string, id: string) {
  const result = await db
    .prepare(
      `UPDATE comment SET body='',deleted_at=COALESCE(deleted_at,?) WHERE id=? AND (user_id=? OR EXISTS(SELECT 1 FROM post WHERE post.id=comment.post_id AND post.user_id=?))`,
    )
    .bind(Date.now(), id, actor, actor)
    .run();
  return Boolean(result.meta.changes);
}
export async function commentPage(
  db: D1Database,
  actor: string,
  postId: string,
  after: string,
) {
  const [time, id] = after
    ? after.split(':')
    : [String(Number.MAX_SAFE_INTEGER), ''];
  const rows = await db
    .prepare(
      `SELECT c.id,c.body,c.created_at AS createdAt,p.handle,p.display_name AS displayName,
 (c.user_id=? OR post.user_id=?) AS canDelete
 FROM comment c JOIN profile p ON p.user_id=c.user_id JOIN membership m ON m.user_id=c.user_id AND m.status='active'
 JOIN post ON post.id=c.post_id
 WHERE c.post_id=? AND c.deleted_at IS NULL AND (c.created_at<? OR (c.created_at=? AND c.id<?))
 AND EXISTS(${writablePost})
 AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=? AND target_id=c.user_id) OR (blocker_id=c.user_id AND target_id=?))
 ORDER BY c.created_at DESC,c.id DESC LIMIT 21`,
    )
    .bind(
      actor,
      actor,
      postId,
      Number(time),
      Number(time),
      id,
      actor,
      postId,
      actor,
      actor,
    )
    .all<{
      id: string;
      createdAt: number;
      body: string;
      handle: string;
      displayName: string;
      canDelete: number;
    }>();
  const last = rows.results[19];
  return {
    items: rows.results.slice(0, 20),
    next: rows.results.length > 20 ? `${last.createdAt}:${last.id}` : null,
  };
}

export async function likePage(
  db: D1Database,
  actor: string,
  postId: string,
  after: string,
) {
  const rows = await db
    .prepare(
      `SELECT p.handle,EXISTS(SELECT 1 FROM avatar WHERE user_id=l.user_id) AS hasAvatar
    FROM post_like l JOIN profile p ON p.user_id=l.user_id JOIN membership m ON m.user_id=l.user_id AND m.status='active'
    WHERE l.post_id=? AND p.handle>? AND EXISTS(${writablePost})
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=? AND target_id=l.user_id) OR (blocker_id=l.user_id AND target_id=?))
    ORDER BY p.handle LIMIT 21`,
    )
    .bind(postId, after, actor, postId, actor, actor)
    .all<{ handle: string; hasAvatar: number }>();
  return {
    items: rows.results.slice(0, 20),
    next: rows.results.length > 20 ? rows.results[19].handle : null,
  };
}

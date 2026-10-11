const events = `WITH viewer AS (SELECT ? AS id),
 visible_actor AS (SELECT m.user_id FROM membership m,viewer v WHERE m.status='active' AND m.user_id!=v.id AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=v.id AND target_id=m.user_id) OR (blocker_id=m.user_id AND target_id=v.id))),
 events AS (
 SELECT 'request:'||f.follower_id AS key,'request' AS kind,NULL AS postId,p.handle,NULL AS body,1 AS count,f.created_at AS createdAt FROM follow f JOIN visible_actor a ON a.user_id=f.follower_id JOIN profile p ON p.user_id=f.follower_id,viewer v WHERE f.target_id=v.id AND f.status='pending'
 UNION ALL
 SELECT 'likes:'||p.id,'likes',p.id,NULL,NULL,COUNT(*),MAX(l.created_at) FROM post_like l JOIN post p ON p.id=l.post_id JOIN visible_actor a ON a.user_id=l.user_id,viewer v WHERE p.user_id=v.id AND p.state='published' GROUP BY p.id
 UNION ALL
 SELECT 'comment:'||c.id,'comment',p.id,author.handle,c.body,1,c.created_at FROM comment c JOIN post p ON p.id=c.post_id JOIN visible_actor a ON a.user_id=c.user_id JOIN profile author ON author.user_id=c.user_id,viewer v WHERE p.user_id=v.id AND p.state='published' AND c.deleted_at IS NULL
 )`;
export type Notification = {
  key: string;
  kind: 'request' | 'likes' | 'comment';
  postId: string | null;
  handle: string | null;
  body: string | null;
  count: number;
  createdAt: number;
  unread: number;
};
export function parsePage(
  value: string | undefined,
): { time: number; key: string } | null {
  if (!value) return null;
  if (value.length > 400) throw new Error('Invalid page.');
  try {
    const p = JSON.parse(atob(value));
    if (
      !Number.isSafeInteger(p.time) ||
      p.time < 0 ||
      typeof p.key !== 'string' ||
      p.key.length > 100
    )
      throw new Error();
    return { time: p.time, key: p.key };
  } catch {
    throw new Error('Invalid page.');
  }
}
export async function notificationPage(
  db: D1Database,
  actor: string,
  cursor: ReturnType<typeof parsePage>,
) {
  const rows = await db
    .prepare(
      `${events} SELECT e.*, (e.createdAt>COALESCE(r.read_through,-1)) AS unread FROM events e CROSS JOIN viewer v LEFT JOIN notification_read r ON r.user_id=v.id AND r.event_key=e.key
 WHERE e.createdAt<? OR (e.createdAt=? AND e.key<?) ORDER BY e.createdAt DESC,e.key DESC LIMIT 21`,
    )
    .bind(
      actor,
      cursor?.time ?? Number.MAX_SAFE_INTEGER,
      cursor?.time ?? Number.MAX_SAFE_INTEGER,
      cursor?.key ?? '',
    )
    .all<Notification>();
  const items = rows.results.slice(0, 20),
    last = items.at(-1);
  return {
    items,
    next:
      rows.results.length > 20 && last
        ? btoa(JSON.stringify({ time: last.createdAt, key: last.key }))
        : null,
  };
}
export async function markRead(
  db: D1Database,
  actor: string,
  items: { key: string; createdAt: number }[],
) {
  if (!items.length) return;
  await db
    .prepare(
      `${events} INSERT INTO notification_read(user_id,event_key,read_through)
 SELECT v.id,e.key,e.createdAt FROM events e CROSS JOIN viewer v JOIN json_each(?) input ON json_extract(input.value,'$.key')=e.key AND json_extract(input.value,'$.createdAt')=e.createdAt WHERE true
 ON CONFLICT(user_id,event_key) DO UPDATE SET read_through=MAX(read_through,excluded.read_through)`,
    )
    .bind(actor, JSON.stringify(items))
    .run();
}

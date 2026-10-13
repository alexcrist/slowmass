// The source index finds recent candidates without aggregating lifetime history.
// Visibility remains authoritative at read time, including when a block hides
// the newest like and the group's visible timestamp must move backwards.
const visibleActor = (alias: string) => `
 EXISTS(SELECT 1 FROM membership m WHERE m.user_id=${alias}.actor_id AND m.status='active')
 AND NOT EXISTS(SELECT 1 FROM block b WHERE (b.blocker_id=${alias}.recipient_id AND b.target_id=${alias}.actor_id) OR (b.blocker_id=${alias}.actor_id AND b.target_id=${alias}.recipient_id))`;
const latestLike = `SELECT n.actor_id FROM activity_source n
 WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}
 ORDER BY n.created_at DESC,n.actor_id DESC LIMIT 1`;
const visibleSource = `
 EXISTS(SELECT 1 FROM membership v WHERE v.user_id=e.recipient_id AND v.status='active')
 AND ${visibleActor('e')}
 AND (e.kind='request'
   OR (e.kind='joined'
     AND EXISTS(SELECT 1 FROM membership child WHERE child.user_id=e.actor_id AND child.invited_by=e.recipient_id)
     AND EXISTS(SELECT 1 FROM avatar WHERE user_id=e.actor_id)
     AND EXISTS(SELECT 1 FROM profile WHERE user_id=e.actor_id))
   OR (e.kind='follower'
     AND EXISTS(SELECT 1 FROM follow f WHERE f.follower_id=e.actor_id AND f.target_id=e.recipient_id AND f.status='accepted')
     AND EXISTS(SELECT 1 FROM avatar WHERE user_id=e.actor_id)
     AND EXISTS(SELECT 1 FROM avatar WHERE user_id=e.recipient_id))
   OR EXISTS(SELECT 1 FROM post p WHERE p.id=e.post_id AND p.user_id=e.recipient_id AND p.state='published'))`;
const eligible = `${visibleSource}
 AND (e.kind!='likes' OR e.actor_id=(${latestLike}))`;
export type Notification = {
  key: string;
  kind: 'request' | 'follower' | 'joined' | 'likes' | 'comment';
  postId: string | null;
  handle: string | null;
  body: string | null;
  count: number;
  createdAt: number;
  version: number;
  unread: boolean;
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
export function validNotificationKey(key: string) {
  return /^(request|follower|joined|likes|comment):[a-zA-Z0-9-]{1,64}$/.test(
    key,
  );
}
export async function notificationStart(
  db: D1Database,
  actor: string,
  key: string,
  includeJoined = true,
) {
  const item = await db
    .prepare(
      `SELECT e.created_at AS time,e.event_key AS key FROM activity_source e
    WHERE e.recipient_id=? AND e.event_key=? AND ${includeJoined ? '1' : "e.kind!='joined'"} AND ${eligible} LIMIT 1
  `,
    )
    .bind(actor, key)
    .first<{ time: number; key: string }>();
  // The normal exclusive cursor then includes this exact item at the top.
  return item ? { time: item.time, key: item.key + '\uffff' } : null;
}
export async function notificationPage(
  db: D1Database,
  actor: string,
  cursor: ReturnType<typeof parsePage>,
  filter: 'all' | 'requests' = 'all',
  includeJoined = true,
) {
  const rows = await db
    .prepare(
      `WITH chosen AS MATERIALIZED (
    SELECT e.* FROM activity_source e
    WHERE e.recipient_id=? AND ${includeJoined ? '1' : "e.kind!='joined'"} AND ${filter === 'requests' ? "e.kind='request' AND" : ''}
    (e.created_at,e.event_key)<(?,?) AND ${eligible}
    ORDER BY e.created_at DESC,e.event_key DESC LIMIT 21
  ) SELECT e.event_key AS key,e.kind,e.post_id AS postId,
    CASE WHEN e.kind!='likes' THEN (SELECT handle FROM profile WHERE user_id=e.actor_id) END AS handle,
    CASE WHEN e.kind='comment' THEN (SELECT body FROM comment WHERE id=substr(e.event_key,9)) END AS body,
    CASE WHEN e.kind='likes' THEN (SELECT COUNT(*) FROM activity_source n WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}) ELSE 1 END AS count,
    e.created_at AS createdAt,
    (SELECT MAX(r.revision) FROM activity_source n JOIN activity_read_state r
      USING(recipient_id,event_key,actor_id)
      WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}) AS version,
    EXISTS(SELECT 1 FROM activity_read_state r JOIN activity_source n USING(recipient_id,event_key,actor_id)
      WHERE r.recipient_id=e.recipient_id AND r.event_key=e.event_key AND r.is_read=0 AND ${visibleActor('n')}) AS unread
    FROM chosen e
    ORDER BY e.created_at DESC,e.event_key DESC`,
    )
    .bind(actor, cursor?.time ?? Number.MAX_SAFE_INTEGER, cursor?.key ?? '')
    .all<Omit<Notification, 'unread'> & { unread: number }>();
  const items = rows.results
      .slice(0, 20)
      .map((item) => ({ ...item, unread: Boolean(item.unread) })),
    last = items.at(-1);
  return {
    items,
    next:
      rows.results.length > 20 && last
        ? btoa(JSON.stringify({ time: last.createdAt, key: last.key }))
        : null,
  };
}

// Seek only unread receipts, deduplicate groups, and stop at the badge's 99+ cap.
export async function unreadCount(
  db: D1Database,
  actor: string,
  includeJoined = true,
) {
  return (
    (await db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
    SELECT DISTINCT r.event_key FROM activity_read_state r
    JOIN activity_source e USING(recipient_id,event_key,actor_id)
    WHERE r.recipient_id=? AND r.is_read=0 AND ${includeJoined ? '1' : "e.kind!='joined'"} AND ${visibleSource} LIMIT 100
  )`,
      )
      .bind(actor)
      .first<number>('count')) ?? 0
  );
}

export type ReadReceipt = { key: string; version: number };
export async function isUnreadNotification(
  db: D1Database,
  actor: string,
  receipt: ReadReceipt,
) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM activity_read_state r
    JOIN activity_source e USING(recipient_id,event_key,actor_id)
    WHERE r.revision=? AND r.recipient_id=? AND r.event_key=? AND r.is_read=0 AND ${visibleSource}
  `,
      )
      .bind(receipt.version, actor, receipt.key)
      .first(),
  );
}
export async function markRead(
  db: D1Database,
  actor: string,
  items: ReadReceipt[],
) {
  // Validate the exact observed source version. A stale receipt can clear older
  // visible sources in its group, but never a newer interaction or hidden actor.
  await db
    .prepare(
      `WITH input AS MATERIALIZED (
    SELECT json_extract(value,'$.key') AS key,json_extract(value,'$.version') AS version FROM json_each(?)
  ), valid AS MATERIALIZED (
    SELECT i.key,i.version FROM input i CROSS JOIN activity_read_state r ON r.revision=i.version
    CROSS JOIN activity_source e USING(recipient_id,event_key,actor_id)
    WHERE e.recipient_id=? AND e.event_key=i.key AND ${visibleSource}
  ) UPDATE activity_read_state SET is_read=1 WHERE revision IN (
    SELECT r.revision FROM valid i CROSS JOIN activity_read_state r
    CROSS JOIN activity_source e USING(recipient_id,event_key,actor_id)
    WHERE r.recipient_id=? AND r.event_key=i.key AND r.revision<=i.version
      AND r.is_read=0 AND ${visibleSource}
  )
  `,
    )
    .bind(JSON.stringify(items), actor, actor)
    .run();
}

import type { NotificationCategory } from '../../../shared/notification-categories';
import { EVENT_OVER_AFTER } from '../../membership';
// The source index finds recent candidates without aggregating lifetime history.
// Visibility remains authoritative at read time, including when a block hides
// the newest like and the group's visible timestamp must move backwards.
const visibleActor = (alias: string) => `
 EXISTS(SELECT 1 FROM membership m WHERE m.user_id=${alias}.actor_id AND m.status='active')
 AND NOT EXISTS(SELECT 1 FROM block b WHERE (b.blocker_id=${alias}.recipient_id AND b.target_id=${alias}.actor_id) OR (b.blocker_id=${alias}.actor_id AND b.target_id=${alias}.recipient_id))`;
const latestLike = `SELECT n.actor_id FROM activity_source n
 WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}
 ORDER BY n.created_at DESC,n.actor_id DESC LIMIT 1`;
// Event keys name their source, like comment keys: 'event_response:<event>.<member>',
// 'event_message:<message>', 'host_invite:<event>' and 'host_accepted:<event>.<member>'.
// Event activity follows event access: a published event whose creator is
// active and unblocked, which the recipient still hosts or has answered.
const eventId = `CASE e.kind WHEN 'event_response' THEN substr(e.event_key,16,36)
 WHEN 'event_message' THEN (SELECT event_id FROM event_message WHERE id=substr(e.event_key,15))
 WHEN 'host_invite' THEN substr(e.event_key,13,36)
 WHEN 'host_accepted' THEN substr(e.event_key,15,36) END`;
const eventAccess = `ev.state='published'
 AND EXISTS(SELECT 1 FROM membership c WHERE c.user_id=ev.creator_id AND c.status='active')
 AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=e.recipient_id AND target_id=ev.creator_id) OR (blocker_id=ev.creator_id AND target_id=e.recipient_id))`;
const recipientHosts = `EXISTS(SELECT 1 FROM event_host WHERE event_id=ev.id AND user_id=e.recipient_id)`;
// A co-host invitation shows while it can still be accepted: its sender hosts,
// both people stay connected, and the event is current and open. Once
// accepted, it remains as the record of hosting while the recipient hosts.
const hostInvitation = `EXISTS(SELECT 1 FROM event ev WHERE ev.id=substr(e.event_key,13,36) AND ${eventAccess}
 AND (${recipientHosts}
   OR (ev.cancelled_at IS NULL AND COALESCE(ev.ends_at,ev.starts_at+${EVENT_OVER_AFTER})>unixepoch()*1000
     AND EXISTS(SELECT 1 FROM event_host_member_invite i
       JOIN event_host h ON h.event_id=i.event_id AND h.user_id=i.invited_by
       WHERE i.event_id=ev.id AND i.user_id=e.recipient_id AND i.invited_by=e.actor_id AND i.link_id=ev.link_id)
     AND EXISTS(SELECT 1 FROM follow WHERE status='accepted'
       AND ((follower_id=e.actor_id AND target_id=e.recipient_id) OR (follower_id=e.recipient_id AND target_id=e.actor_id))))))`;
const visibleSource = `
 EXISTS(SELECT 1 FROM membership v WHERE v.user_id=e.recipient_id AND v.status='active')
 AND ${visibleActor('e')}
 AND (e.kind='request'
   OR (e.kind='event_response' AND EXISTS(SELECT 1 FROM event ev
     JOIN event_host h ON h.event_id=ev.id AND h.user_id=e.recipient_id
     JOIN event_response r ON r.event_id=ev.id AND r.user_id=e.actor_id
     WHERE ev.id=substr(e.event_key,16,36) AND ${eventAccess}))
   OR (e.kind='event_message' AND EXISTS(SELECT 1 FROM event ev
     JOIN event_message msg ON msg.event_id=ev.id AND msg.id=substr(e.event_key,15) AND msg.deleted_at IS NULL AND msg.kind!='changed'
     WHERE ${eventAccess}
       AND (EXISTS(SELECT 1 FROM event_host WHERE event_id=ev.id AND user_id=e.recipient_id)
         OR EXISTS(SELECT 1 FROM event_response WHERE event_id=ev.id AND user_id=e.recipient_id))))
   OR (e.kind='host_invite' AND ${hostInvitation})
   OR (e.kind='host_accepted' AND EXISTS(SELECT 1 FROM event ev
     JOIN event_host h ON h.event_id=ev.id AND h.user_id=e.actor_id
     WHERE ev.id=substr(e.event_key,15,36) AND ${eventAccess} AND ${recipientHosts}))
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
  kind:
    | 'request'
    | 'follower'
    | 'joined'
    | 'likes'
    | 'comment'
    | 'event_response'
    | 'event_message'
    | 'host_invite'
    | 'host_accepted';
  postId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  // The guest's current answer, or the kind of event message.
  response: 'going' | 'maybe' | 'declined' | null;
  messageKind: 'message' | 'cancelled' | null;
  // Whether the recipient of a co-host invitation has accepted it.
  hosting: boolean;
  handle: string | null;
  // Event activity names people, since guests never choose a username.
  displayName: string | null;
  body: string | null;
  count: number;
  createdAt: number;
  version: number;
  unread: boolean;
  canFollowBack: boolean;
  // A later like group on a post that already has an earlier visible group.
  more: boolean;
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
      p.key.length > 140
    )
      throw new Error();
    return { time: p.time, key: p.key };
  } catch {
    throw new Error('Invalid page.');
  }
}
export function validNotificationKey(key: string) {
  return /^(?:(?:request|follower|joined|likes|comment):[a-zA-Z0-9-]{1,64}|event_response:[a-f0-9-]{36}\.[a-zA-Z0-9-]{1,64}|event_message:[a-f0-9-]{36}|host_invite:[a-f0-9-]{36}|host_accepted:[a-f0-9-]{36}\.[a-zA-Z0-9-]{1,64})$/.test(
    key,
  );
}
// Older open clients cannot render newer kinds; this affects rendering only.
export type ActivityKinds = {
  joined: boolean;
  events: boolean;
  hosting: boolean;
};
const allKinds: ActivityKinds = { joined: true, events: true, hosting: true };
function kindFilter(kinds: ActivityKinds) {
  const hidden = [
    ...(kinds.joined ? [] : ["'joined'"]),
    ...(kinds.events ? [] : ["'event_response'", "'event_message'"]),
    ...(kinds.hosting ? [] : ["'host_invite'", "'host_accepted'"]),
  ];
  return hidden.length ? `e.kind NOT IN (${hidden.join(',')})` : '1';
}
export async function notificationStart(
  db: D1Database,
  actor: string,
  key: string,
  kinds = allKinds,
) {
  const item = await db
    .prepare(
      `SELECT e.created_at AS time,e.event_key AS key FROM activity_source e
    WHERE e.recipient_id=? AND e.event_key=? AND ${kindFilter(kinds)} AND ${eligible} LIMIT 1
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
  kinds = allKinds,
) {
  const rows = await db
    .prepare(
      `WITH chosen AS MATERIALIZED (
    SELECT e.* FROM activity_source e
    WHERE e.recipient_id=? AND ${kindFilter(kinds)} AND ${filter === 'requests' ? "e.kind='request' AND" : ''}
    (e.created_at,e.event_key)<(?,?) AND ${eligible}
    ORDER BY e.created_at DESC,e.event_key DESC LIMIT 21
  ) SELECT e.event_key AS key,e.kind,e.post_id AS postId,${eventId} AS eventId,
    (SELECT title FROM event WHERE id=${eventId}) AS eventTitle,
    CASE WHEN e.kind='event_response' THEN (SELECT status FROM event_response WHERE event_id=${eventId} AND user_id=e.actor_id) END AS response,
    CASE WHEN e.kind='event_message' THEN (SELECT kind FROM event_message WHERE id=substr(e.event_key,15)) END AS messageKind,
    (e.kind='host_invite' AND EXISTS(SELECT 1 FROM event_host WHERE event_id=${eventId} AND user_id=e.recipient_id)) AS hosting,
    CASE WHEN e.kind!='likes' THEN (SELECT handle FROM profile WHERE user_id=e.actor_id) END AS handle,
    CASE WHEN e.kind IN ('event_response','event_message','host_invite','host_accepted') THEN (SELECT display_name FROM profile WHERE user_id=e.actor_id) END AS displayName,
    CASE WHEN e.kind='comment' THEN (SELECT body FROM comment WHERE id=substr(e.event_key,9))
      WHEN e.kind='event_message' THEN (SELECT body FROM event_message WHERE id=substr(e.event_key,15)) END AS body,
    CASE WHEN e.kind='likes' THEN (SELECT COUNT(*) FROM activity_source n WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}) ELSE 1 END AS count,
    e.created_at AS createdAt,
    (e.kind='follower'
      AND NOT EXISTS(SELECT 1 FROM follow f WHERE f.follower_id=e.recipient_id AND f.target_id=e.actor_id)
      AND EXISTS(SELECT 1 FROM activity_read_state r WHERE r.recipient_id=e.recipient_id
        AND r.event_key=e.event_key AND r.actor_id=e.actor_id AND r.follow_back_dismissed=0)) AS canFollowBack,
    (e.kind='likes' AND EXISTS(SELECT 1 FROM activity_source o
      WHERE o.recipient_id=e.recipient_id AND o.event_key>='likes:'||e.post_id
        AND o.event_key<'likes:'||e.post_id||'.' AND o.event_key!=e.event_key
        AND o.created_at<e.created_at AND ${visibleActor('o')})) AS more,
    (SELECT MAX(r.revision) FROM activity_source n JOIN activity_read_state r
      USING(recipient_id,event_key,actor_id)
      WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}) AS version,
    EXISTS(SELECT 1 FROM activity_read_state r JOIN activity_source n USING(recipient_id,event_key,actor_id)
      WHERE r.recipient_id=e.recipient_id AND r.event_key=e.event_key AND r.is_read=0 AND ${visibleActor('n')}) AS unread
    FROM chosen e
    ORDER BY e.created_at DESC,e.event_key DESC`,
    )
    .bind(actor, cursor?.time ?? Number.MAX_SAFE_INTEGER, cursor?.key ?? '')
    .all<
      Omit<Notification, 'unread' | 'canFollowBack' | 'more' | 'hosting'> & {
        unread: number;
        canFollowBack: number;
        more: number;
        hosting: number;
      }
    >();
  const items = rows.results.slice(0, 20).map((item) => ({
      ...item,
      unread: Boolean(item.unread),
      canFollowBack: Boolean(item.canFollowBack),
      more: Boolean(item.more),
      hosting: Boolean(item.hosting),
    })),
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
  kinds = allKinds,
) {
  return (
    (await db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
    SELECT DISTINCT r.event_key FROM activity_read_state r
    JOIN activity_source e USING(recipient_id,event_key,actor_id)
    WHERE r.recipient_id=? AND r.is_read=0 AND ${kindFilter(kinds)} AND ${visibleSource} LIMIT 100
  )`,
      )
      .bind(actor)
      .first<number>('count')) ?? 0
  );
}

export type ReadReceipt = { key: string; version: number };
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

// Exact-version, owner-scoped dismissal is retry-safe and never changes read state.
export async function dismissFollowBack(
  db: D1Database,
  actor: string,
  receipt: ReadReceipt,
) {
  await db
    .prepare(
      `UPDATE activity_read_state SET follow_back_dismissed=1
    WHERE revision=? AND recipient_id=? AND event_key=?
      AND EXISTS(SELECT 1 FROM activity_source e
        WHERE e.recipient_id=activity_read_state.recipient_id
          AND e.event_key=activity_read_state.event_key
          AND e.actor_id=activity_read_state.actor_id
          AND e.kind='follower' AND ${visibleSource})`,
    )
    .bind(receipt.version, actor, receipt.key)
    .run();
}

// The preference category of a source: its kind, except that event messages
// split into ordinary messages, update blasts and cancellations.
const categoryOf = `CASE WHEN e.kind='event_message' THEN COALESCE(
  (SELECT CASE WHEN m.kind='cancelled' THEN 'event_cancelled' WHEN m.blast=1 THEN 'update_blast' ELSE 'event_message' END
    FROM event_message m WHERE m.id=substr(e.event_key,15)),'event_message') ELSE e.kind END`;
export type DescribedNotification = {
  key: string;
  kind: Notification['kind'];
  category: NotificationCategory;
  postId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  response: Notification['response'];
  // For likes, the newest visible liker; otherwise the actor.
  handle: string | null;
  displayName: string | null;
  body: string | null;
  count: number;
  // Whether this exact version is still unread, and the member's choices.
  unread: boolean;
  push: boolean;
  email: boolean;
};
// One visible notification for push or email delivery, rechecking the same
// visibility as Activity at send time. Returns null once it is hidden.
export async function describeNotification(
  db: D1Database,
  recipient: string,
  key: string,
  version: number,
): Promise<DescribedNotification | null> {
  const row = await db
    .prepare(
      `SELECT e.event_key AS key,e.kind,c.id AS category,e.post_id AS postId,${eventId} AS eventId,
    (SELECT title FROM event WHERE id=${eventId}) AS eventTitle,
    CASE WHEN e.kind='event_response' THEN (SELECT status FROM event_response WHERE event_id=${eventId} AND user_id=e.actor_id) END AS response,
    (SELECT handle FROM profile WHERE user_id=e.actor_id) AS handle,
    (SELECT display_name FROM profile WHERE user_id=e.actor_id) AS displayName,
    CASE WHEN e.kind='comment' THEN (SELECT body FROM comment WHERE id=substr(e.event_key,9))
      WHEN e.kind='event_message' THEN (SELECT body FROM event_message WHERE id=substr(e.event_key,15)) END AS body,
    CASE WHEN e.kind='likes' THEN (SELECT COUNT(*) FROM activity_source n WHERE n.recipient_id=e.recipient_id AND n.event_key=e.event_key AND ${visibleActor('n')}) ELSE 1 END AS count,
    EXISTS(SELECT 1 FROM activity_read_state r WHERE r.revision=? AND r.recipient_id=e.recipient_id
      AND r.event_key=e.event_key AND r.is_read=0) AS unread,
    COALESCE(p.push,c.push) AS push,COALESCE(p.email,c.email) AS email
    FROM activity_source e
    JOIN notification_category c ON c.id=${categoryOf}
    LEFT JOIN notification_preference p ON p.user_id=e.recipient_id AND p.category=c.id
    WHERE e.recipient_id=? AND e.event_key=? AND ${eligible} LIMIT 1`,
    )
    .bind(version, recipient, key)
    .first<
      Omit<DescribedNotification, 'unread' | 'push' | 'email'> & {
        unread: number;
        push: number;
        email: number;
      }
    >();
  return row
    ? {
        ...row,
        unread: Boolean(row.unread),
        push: Boolean(row.push),
        email: Boolean(row.email),
      }
    : null;
}

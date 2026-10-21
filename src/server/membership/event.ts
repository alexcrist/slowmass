import { invitationTokenHash } from './credential';
import { SIGN_IN_LINK_SECONDS } from '../../shared/sign-in';

// Event admission: who may open or answer an event, and joining slowmass by
// signing in through an event link. The events feature owns everything else
// about events. An event without an end time is over twelve hours after it
// starts; migration 0030 uses the same value. Answers are capped to bound
// notification fan-out.
export const EVENT_OVER_AFTER = 43_200_000;
export const MAX_EVENT_RESPONSES = 500;
const available = `e.state='published'
 AND EXISTS(SELECT 1 FROM membership c WHERE c.user_id=e.creator_id AND c.status='active')`;
// New people join only while the event is open and its creator can invite.
const admitting = `${available} AND e.cancelled_at IS NULL
 AND COALESCE(e.ends_at,e.starts_at+${EVENT_OVER_AFTER})>?
 AND EXISTS(SELECT 1 FROM avatar WHERE user_id=e.creator_id)`;
const claimed = `JOIN event e ON e.id=c.event_id AND e.link_id=c.link_id AND e.link_hash=c.link_hash`;
const unblocked = (member: string) =>
  `NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=${member} AND target_id=e.creator_id) OR (blocker_id=e.creator_id AND target_id=${member}))`;

// Record that a member opened the event through its current link. Hosts need
// no record. Opening a new link version (after restore quarantine) records it.
export function eventAccess(
  db: D1Database,
  userId: string,
  event: { linkHash: string } | { claimHash: string },
) {
  const target =
    'linkHash' in event
      ? 'e.link_hash=?'
      : `e.id=(SELECT c.event_id FROM event_claim c JOIN user u ON u.id=m.user_id AND lower(u.email)=c.email
          WHERE c.token_hash=? AND c.expires_at>?) AND e.link_id=(SELECT link_id FROM event_claim WHERE token_hash=?)`;
  const now = Date.now();
  return db
    .prepare(
      `INSERT INTO event_access(event_id,user_id,link_id,created_at)
      SELECT e.id,m.user_id,e.link_id,? FROM event e JOIN membership m ON m.user_id=? AND m.status='active'
      WHERE ${target} AND ${available} AND ${unblocked('m.user_id')}
        AND NOT EXISTS(SELECT 1 FROM event_host WHERE event_id=e.id AND user_id=m.user_id)
      ON CONFLICT(event_id,user_id) DO UPDATE SET link_id=excluded.link_id,created_at=excluded.created_at
      WHERE link_id!=excluded.link_id`,
    )
    .bind(
      now,
      userId,
      ...('linkHash' in event
        ? [event.linkHash]
        : [event.claimHash, now, event.claimHash]),
    );
}

// One answer per member: blocks with the creator deny access, and only hosts,
// members who already answered, or members who opened the current link may
// answer while the event is open. Hosts are bounded separately, so they never
// count against the answer cap.
export function eventResponse(
  db: D1Database,
  userId: string,
  eventId: string,
  status: string,
) {
  const now = Date.now();
  return db
    .prepare(
      `INSERT INTO event_response(event_id,user_id,status,created_at,updated_at)
      SELECT e.id,m.user_id,?,?,? FROM event e JOIN membership m ON m.user_id=? AND m.status='active'
      WHERE e.id=? AND ${available} AND e.cancelled_at IS NULL
        AND COALESCE(e.ends_at,e.starts_at+${EVENT_OVER_AFTER})>?
        AND EXISTS(SELECT 1 FROM profile WHERE user_id=m.user_id)
        AND ${unblocked('m.user_id')}
        AND (EXISTS(SELECT 1 FROM event_host WHERE event_id=e.id AND user_id=m.user_id)
          OR EXISTS(SELECT 1 FROM event_response WHERE event_id=e.id AND user_id=m.user_id)
          OR (EXISTS(SELECT 1 FROM event_access a WHERE a.event_id=e.id AND a.user_id=m.user_id AND a.link_id=e.link_id)
            AND (SELECT COUNT(*) FROM event_response WHERE event_id=e.id)<${MAX_EVENT_RESPONSES}))
      ON CONFLICT(event_id,user_id) DO UPDATE SET status=excluded.status,
        updated_at=CASE WHEN status=excluded.status THEN updated_at ELSE excluded.updated_at END`,
    )
    .bind(status, now, now, userId, eventId, now);
}

// Pin the exact link version to the email token. Members can sign in through
// any working link to view the event; new people only while it admits them.
export async function bindEventVerification(
  db: D1Database,
  link: unknown,
  email: string,
  verificationToken: string,
  member: boolean,
) {
  if (typeof link !== 'string' || !/^[a-zA-Z0-9]{48}$/.test(link)) return false;
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO event_claim(token_hash,invitation_id,event_id,inviter_id,link_id,link_hash,email,expires_at)
      SELECT ?,?,e.id,e.creator_id,e.link_id,e.link_hash,?,? FROM event e
      WHERE e.link_hash=? AND ${member ? available : admitting}`,
    )
    .bind(
      await invitationTokenHash(verificationToken),
      crypto.randomUUID(),
      email.trim().toLowerCase(),
      now + SIGN_IN_LINK_SECONDS * 1000,
      await invitationTokenHash(link),
      ...(member ? [] : [now]),
    )
    .run();
  return result.meta.changes > 0;
}

// Whether a new person may join through this claim.
export async function eventClaim(
  db: D1Database,
  verificationToken: string,
  email: string,
) {
  const now = Date.now();
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM event_claim c ${claimed}
        WHERE c.token_hash=? AND c.expires_at>? AND c.email=? AND ${admitting}`,
      )
      .bind(
        await invitationTokenHash(verificationToken),
        now,
        email.trim().toLowerCase(),
        now,
      )
      .first(),
  );
}

// Sign a member in through an event link: new people first become members with
// a shared invitation from the creator that records the event and link
// version. Every statement rechecks the exact claim inside one batch, and
// everyone gets a record of the link version they opened.
export async function acceptEventVerification(
  db: D1Database,
  userId: string,
  token: string,
) {
  const tokenHash = await invitationTokenHash(token);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind,event_id,event_link_id)
        SELECT c.invitation_id,c.inviter_id,c.email,?,c.expires_at,'shared',c.event_id,c.link_id
        FROM event_claim c ${claimed}
        JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
        WHERE c.token_hash=? AND c.expires_at>? AND ${admitting}
          AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
        ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, tokenHash, now, now),
    db
      .prepare(
        `INSERT INTO membership(user_id,invited_by,invitation_id,joined_at)
        SELECT u.id,i.inviter_id,i.id,? FROM event_claim c ${claimed}
        JOIN invitation i ON i.id=c.invitation_id AND i.inviter_id=c.inviter_id
          AND i.recipient_email=c.email AND i.kind='shared'
          AND i.event_id=c.event_id AND i.event_link_id=c.link_id
        JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
        WHERE c.token_hash=? AND c.expires_at>? AND ${admitting}
          AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
          AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
        ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, tokenHash, now, now, now),
    eventAccess(db, userId, { claimHash: tokenHash }),
  ]);
  return Boolean(
    await db
      .prepare("SELECT 1 FROM membership WHERE user_id=? AND status='active'")
      .bind(userId)
      .first(),
  );
}

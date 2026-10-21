import { invitationTokenHash } from './credential';
import { SIGN_IN_LINK_SECONDS } from '../../shared/sign-in';

// Joining slowmass by signing in through a member's invite link. The
// invite-links feature issues and renews links; this module decides whether a
// link admits new people and joins them. A link admits people until it expires
// or is revoked, while its owner is active with a profile photo.
const admitting = `l.revoked_at IS NULL AND l.expires_at>?
 AND EXISTS(SELECT 1 FROM membership WHERE user_id=l.inviter_id AND status='active')
 AND EXISTS(SELECT 1 FROM avatar WHERE user_id=l.inviter_id)`;
const claimed = `JOIN invite_link l ON l.inviter_id=c.inviter_id
 AND l.id=c.invite_link_id AND l.token_hash=c.invite_link_token_hash`;

function validLink(link: unknown): link is string {
  return typeof link === 'string' && /^[a-zA-Z0-9]{48}$/.test(link);
}

// Signed out, a link holder learns only this.
export async function inviteLinkAdmits(db: D1Database, link: unknown) {
  if (!validLink(link)) return false;
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM invite_link l WHERE l.token_hash=? AND ${admitting}`,
      )
      .bind(await invitationTokenHash(link), Date.now())
      .first(),
  );
}

// Pin the exact link version to a new person's email token. Members sign in
// normally and never get a claim.
export async function bindInviteVerification(
  db: D1Database,
  link: unknown,
  email: string,
  verificationToken: string,
) {
  if (!validLink(link)) return false;
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO invite_link_claim(token_hash,invitation_id,inviter_id,invite_link_id,invite_link_token_hash,email,expires_at)
      SELECT ?,?,l.inviter_id,l.id,l.token_hash,?,? FROM invite_link l
      WHERE l.token_hash=? AND ${admitting}`,
    )
    .bind(
      await invitationTokenHash(verificationToken),
      crypto.randomUUID(),
      email.trim().toLowerCase(),
      now + SIGN_IN_LINK_SECONDS * 1000,
      await invitationTokenHash(link),
      now,
    )
    .run();
  return result.meta.changes > 0;
}

// Whether a new person may join through this claim.
export async function inviteClaim(
  db: D1Database,
  verificationToken: string,
  email: string,
) {
  const now = Date.now();
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM invite_link_claim c ${claimed}
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

// New people become members with a shared invitation from the link's owner
// that records the link version. Both statements recheck the exact claim
// inside one batch; someone who became a member meanwhile keeps their
// original attribution.
export async function acceptInviteVerification(
  db: D1Database,
  userId: string,
  token: string,
) {
  const tokenHash = await invitationTokenHash(token);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind,invite_link_id)
        SELECT c.invitation_id,c.inviter_id,c.email,?,MIN(c.expires_at,l.expires_at),'shared',c.invite_link_id
        FROM invite_link_claim c ${claimed}
        JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
        WHERE c.token_hash=? AND c.expires_at>? AND ${admitting}
          AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
        ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, tokenHash, now, now),
    db
      .prepare(
        `INSERT INTO membership(user_id,invited_by,invitation_id,joined_at)
        SELECT u.id,i.inviter_id,i.id,? FROM invite_link_claim c ${claimed}
        JOIN invitation i ON i.id=c.invitation_id AND i.inviter_id=c.inviter_id
          AND i.recipient_email=c.email AND i.kind='shared'
          AND i.event_id IS NULL AND i.invite_link_id=c.invite_link_id
        JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
        WHERE c.token_hash=? AND c.expires_at>? AND ${admitting}
          AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
          AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
        ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, tokenHash, now, now, now),
  ]);
  return Boolean(
    await db
      .prepare("SELECT 1 FROM membership WHERE user_id=? AND status='active'")
      .bind(userId)
      .first(),
  );
}

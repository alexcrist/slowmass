import { invitationTokenHash } from './join';

const available = `l.revoked_at IS NULL AND l.expires_at>?
 AND m.status='active' AND EXISTS(SELECT 1 FROM avatar WHERE user_id=l.inviter_id)`;
const claimedLink = `JOIN invite_link l ON l.inviter_id=c.inviter_id
 AND l.id=c.invite_link_id AND l.token_hash=c.invite_link_token_hash
 JOIN membership m ON m.user_id=l.inviter_id`;

export async function sharedInvitation(db: D1Database, token: unknown) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9]{48}$/.test(token))
    return null;
  return db
    .prepare(
      `SELECT l.id,l.inviter_id AS inviterId,l.expires_at AS expiresAt,p.display_name AS name,p.handle
    FROM invite_link l JOIN membership m ON m.user_id=l.inviter_id JOIN profile p ON p.user_id=l.inviter_id
    WHERE l.token_hash=? AND ${available}`,
    )
    .bind(await invitationTokenHash(token), Date.now())
    .first<{
      id: string;
      inviterId: string;
      expiresAt: number;
      name: string;
      handle: string;
    }>();
}
export async function bindSharedVerification(
  db: D1Database,
  token: unknown,
  email: string,
  verificationToken: string,
) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9]{48}$/.test(token))
    return false;
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO invite_link_claim(token_hash,invitation_id,inviter_id,invite_link_id,invite_link_token_hash,email,expires_at)
    SELECT ?,?,l.inviter_id,l.id,l.token_hash,?,?
    FROM invite_link l JOIN membership m ON m.user_id=l.inviter_id
    WHERE l.token_hash=? AND ${available}`,
    )
    .bind(
      await invitationTokenHash(verificationToken),
      crypto.randomUUID(),
      email.trim().toLowerCase(),
      now + 600_000,
      await invitationTokenHash(token),
      now,
    )
    .run();
  return result.meta.changes > 0;
}
export async function sharedClaim(
  db: D1Database,
  verificationToken: string,
  email?: string,
) {
  return db
    .prepare(
      `SELECT c.invitation_id AS invitationId,c.invite_link_id AS linkId,c.email,
    c.inviter_id AS inviterId,MIN(c.expires_at,l.expires_at) AS expiresAt
    FROM invite_link_claim c ${claimedLink}
    WHERE c.token_hash=? AND c.expires_at>? AND (? IS NULL OR c.email=?) AND ${available}`,
    )
    .bind(
      await invitationTokenHash(verificationToken),
      Date.now(),
      email?.trim().toLowerCase() ?? null,
      email?.trim().toLowerCase() ?? null,
      Date.now(),
    )
    .first<{
      invitationId: string;
      linkId: string;
      email: string;
      inviterId: string;
      expiresAt: number;
    }>();
}
// Retain failed claims until expiry: an old email must never switch inviters.
export async function hasSharedClaim(db: D1Database, token: string) {
  return Boolean(
    await db
      .prepare('SELECT 1 FROM invite_link_claim WHERE token_hash=?')
      .bind(await invitationTokenHash(token))
      .first(),
  );
}
export async function acceptSharedVerification(
  db: D1Database,
  userId: string,
  token: string,
) {
  const tokenHash = await invitationTokenHash(token);
  const now = Date.now();
  // Both writes recheck the exact claim and credential inside one atomic batch.
  await db.batch([
    db
      .prepare(
        `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind)
      SELECT c.invitation_id,c.inviter_id,c.email,?,MIN(c.expires_at,l.expires_at),'shared'
      FROM invite_link_claim c ${claimedLink}
      JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
      WHERE c.token_hash=? AND c.expires_at>? AND ${available}
        AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
      ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, tokenHash, now, now),
    db
      .prepare(
        `INSERT INTO membership(user_id,invited_by,invitation_id,joined_at)
      SELECT u.id,i.inviter_id,i.id,? FROM invite_link_claim c ${claimedLink}
      JOIN invitation i ON i.id=c.invitation_id AND i.inviter_id=c.inviter_id AND i.recipient_email=c.email AND i.kind='shared'
      JOIN user u ON u.id=? AND lower(u.email)=c.email AND u.emailVerified=1
      WHERE c.token_hash=? AND c.expires_at>? AND ${available}
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

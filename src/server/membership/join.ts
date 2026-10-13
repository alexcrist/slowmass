import { generateRandomString } from 'better-auth/crypto';

export async function invitationTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function newInvitationCredential() {
  const token = generateRandomString(48, 'a-z', 'A-Z', '0-9');
  return { token, hash: await invitationTokenHash(token) };
}

export type InvitationJoin =
  | {
      status: 'ready';
      id: string;
      email: string;
      expiresAt: number;
      name: string;
      handle: string;
    }
  | { status: 'invalid' | 'expired' | 'cancelled' | 'used' };

export async function invitationJoin(
  db: D1Database,
  token: unknown,
): Promise<InvitationJoin> {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9]{48}$/.test(token))
    return { status: 'invalid' };
  const row = await db
    .prepare(
      `SELECT i.id,i.recipient_email AS email,i.expires_at AS expiresAt,
    i.accepted_by AS acceptedBy,i.revoked_at AS revokedAt,m.status AS inviterStatus,
    p.display_name AS name,p.handle,
    EXISTS(SELECT 1 FROM user u JOIN membership member ON member.user_id=u.id
      WHERE u.email=i.recipient_email) AS alreadyJoined
    FROM invitation i JOIN membership m ON m.user_id=i.inviter_id
    LEFT JOIN profile p ON p.user_id=i.inviter_id WHERE i.kind='personal' AND i.join_token_hash=?`,
    )
    .bind(await invitationTokenHash(token))
    .first<{
      id: string;
      email: string;
      expiresAt: number;
      acceptedBy: string | null;
      revokedAt: number | null;
      inviterStatus: string;
      name: string | null;
      handle: string | null;
      alreadyJoined: number;
    }>();
  if (!row) return { status: 'invalid' };
  if (row.acceptedBy || row.alreadyJoined) return { status: 'used' };
  if (
    row.revokedAt !== null ||
    row.inviterStatus !== 'active' ||
    !row.handle ||
    !row.name
  )
    return { status: 'cancelled' };
  if (row.expiresAt <= Date.now()) return { status: 'expired' };
  return {
    status: 'ready',
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt,
    name: row.name,
    handle: row.handle,
  };
}

// A single conditional INSERT and the existing acceptance trigger are the
// consumption boundary. Even two different invitation links cannot join twice.
export async function acceptInvitationJoin(
  db: D1Database,
  id: string,
  userId: string,
  token: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO membership (user_id,invited_by,invitation_id,joined_at)
    SELECT u.id,i.inviter_id,i.id,? FROM user u
    JOIN invitation i ON i.recipient_email=u.email
    JOIN membership inviter ON inviter.user_id=i.inviter_id
    WHERE u.id=? AND u.emailVerified=1 AND i.kind='personal' AND i.id=? AND i.join_token_hash=?
      AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
      AND inviter.status='active' AND NOT EXISTS(SELECT 1 FROM membership WHERE user_id=u.id)
    ON CONFLICT DO NOTHING`,
    )
    .bind(now, userId, id, await invitationTokenHash(token), now)
    .run();
  return result.meta.changes > 0;
}

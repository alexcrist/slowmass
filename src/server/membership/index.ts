export { newInvitationCredential, invitationTokenHash } from './credential';
export {
  EVENT_OVER_AFTER,
  MAX_EVENT_RESPONSES,
  eventAccess,
  eventResponse,
  bindEventVerification,
  hasEventClaim,
  eventClaim,
  acceptEventVerification,
} from './event';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function activeMember(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM membership WHERE user_id = ? AND status = 'active'",
      )
      .bind(userId)
      .first(),
  );
}

// Fresh request authorization; never cache completion or membership across requests.
export async function memberAccess(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM avatar WHERE user_id=m.user_id) AS hasProfilePhoto
       FROM membership m WHERE m.user_id=? AND m.status='active'`,
    )
    .bind(userId)
    .first<{ hasProfilePhoto: number }>();
  return row ? { hasProfilePhoto: Boolean(row.hasProfilePhoto) } : null;
}

// Event links are the only invitations. Without one, only the configured first
// member can join, and only while no membership exists.
export async function canJoin(
  db: D1Database,
  email: string,
  bootstrapEmail?: string,
): Promise<boolean> {
  const recipient = normalizeEmail(email);
  if (!recipient || !bootstrapEmail) return false;
  return (
    recipient === normalizeEmail(bootstrapEmail) &&
    !(await db.prepare('SELECT 1 FROM membership LIMIT 1').first())
  );
}

// The unique-root index arbitrates simultaneous first sign-ins.
export async function ensureMembership(
  db: D1Database,
  userId: string,
  bootstrapEmail?: string,
): Promise<boolean> {
  if (await activeMember(db, userId)) return true;
  if (!bootstrapEmail) return false;
  await db
    .prepare(
      `INSERT INTO membership (user_id, invited_by, invitation_id, joined_at)
    SELECT id, NULL, NULL, ? FROM user
    WHERE id = ? AND emailVerified = 1 AND lower(email) = ?
      AND NOT EXISTS (SELECT 1 FROM membership)
    ON CONFLICT DO NOTHING`,
    )
    .bind(Date.now(), userId, normalizeEmail(bootstrapEmail))
    .run();
  return activeMember(db, userId);
}

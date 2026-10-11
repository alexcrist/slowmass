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

export async function canJoin(
  db: D1Database,
  email: string,
  bootstrapEmail?: string,
): Promise<boolean> {
  const recipient = normalizeEmail(email);
  if (!recipient) return false;
  if (bootstrapEmail && recipient === normalizeEmail(bootstrapEmail)) {
    if (!(await db.prepare('SELECT 1 FROM membership LIMIT 1').first()))
      return true;
  }
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM invitation i
    JOIN membership m ON m.user_id = i.inviter_id
    WHERE i.recipient_email = ? AND m.status = 'active'
      AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? LIMIT 1`,
      )
      .bind(recipient, Date.now())
      .first(),
  );
}

// One INSERT and database triggers atomically consume the invitation and retain provenance.
export async function ensureMembership(
  db: D1Database,
  userId: string,
  bootstrapEmail?: string,
): Promise<boolean> {
  if (await activeMember(db, userId)) return true;
  if (
    await db
      .prepare('SELECT 1 FROM membership WHERE user_id = ?')
      .bind(userId)
      .first()
  )
    return false;
  const now = Date.now();
  if (bootstrapEmail) {
    await db
      .prepare(
        `INSERT INTO membership (user_id, invited_by, invitation_id, joined_at)
      SELECT id, NULL, NULL, ? FROM user
      WHERE id = ? AND emailVerified = 1 AND lower(email) = ?
        AND NOT EXISTS (SELECT 1 FROM membership)
      ON CONFLICT DO NOTHING`,
      )
      .bind(now, userId, normalizeEmail(bootstrapEmail))
      .run();
  }
  await db
    .prepare(
      `INSERT INTO membership (user_id, invited_by, invitation_id, joined_at)
    SELECT u.id, i.inviter_id, i.id, ? FROM user u
    JOIN invitation i ON i.recipient_email = lower(u.email)
    JOIN membership inviter ON inviter.user_id = i.inviter_id
    WHERE u.id = ? AND u.emailVerified = 1 AND inviter.status = 'active'
      AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM membership WHERE user_id = u.id)
    ORDER BY i.created_at, i.id LIMIT 1
    ON CONFLICT DO NOTHING`,
    )
    .bind(now, userId, now)
    .run();
  return activeMember(db, userId);
}

export async function issueInvitation(
  db: D1Database,
  inviterId: string,
  email: string,
): Promise<{ id: string; expiresAt: number } | null> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const expiresAt = now + 7 * 86400000;
  const result = await db
    .prepare(
      `INSERT INTO invitation (id, inviter_id, recipient_email, created_at, expires_at)
    SELECT ?, user_id, ?, ?, ? FROM membership
    WHERE user_id = ? AND status = 'active'
      AND (SELECT COUNT(*) FROM invitation WHERE inviter_id = ? AND created_at > ?) < 5
      AND NOT EXISTS (SELECT 1 FROM user u JOIN membership m ON m.user_id = u.id WHERE lower(u.email) = ?)
      AND NOT EXISTS (SELECT 1 FROM invitation WHERE inviter_id = ? AND recipient_email = ? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at > ?)`,
    )
    .bind(
      id,
      normalizeEmail(email),
      now,
      expiresAt,
      inviterId,
      inviterId,
      now - 86400000,
      normalizeEmail(email),
      inviterId,
      normalizeEmail(email),
      now,
    )
    .run();
  return result.meta.changes ? { id, expiresAt } : null;
}

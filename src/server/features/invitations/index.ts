export { cleanupInviteLinks } from './links';
import { issueInvitation } from '../../membership';

export async function createInvitation(
  db: D1Database,
  actor: string,
  email: string,
) {
  const created = await issueInvitation(db, actor, email);
  const invitation =
    created ??
    (await db
      .prepare(
        `SELECT id,expires_at AS expiresAt FROM invitation
    WHERE kind='personal' AND inviter_id=? AND recipient_email=? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(actor, email.trim().toLowerCase(), Date.now())
      .first<{ id: string; expiresAt: number }>());
  return { created: Boolean(created), invitation };
}
export async function invitationPage(
  db: D1Database,
  actor: string,
  before: number,
  id: string,
  now: number,
) {
  const result = await db
    .prepare(
      `SELECT id,recipient_email AS email,created_at AS createdAt,expires_at AS expiresAt,accepted_by AS acceptedBy,revoked_at AS revokedAt,email_sent_at AS sentAt,email_attempted_at AS attemptedAt FROM invitation WHERE kind='personal' AND inviter_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT 21`,
    )
    .bind(actor, before, id)
    .all<{
      id: string;
      email: string;
      createdAt: number;
      expiresAt: number;
      acceptedBy: string | null;
      revokedAt: number | null;
      sentAt: number | null;
      attemptedAt: number | null;
    }>();
  const items = result.results.slice(0, 20).map(({ acceptedBy, ...item }) => ({
    ...item,
    accepted: Boolean(acceptedBy),
    expired: item.expiresAt <= now,
  }));
  const last = items.at(-1);
  return {
    items,
    next:
      result.results.length > 20 && last
        ? `${last.createdAt}:${last.id}`
        : null,
  };
}
export async function cancelInvitation(
  db: D1Database,
  actor: string,
  id: string,
) {
  await db
    .prepare(
      "UPDATE invitation SET revoked_at=COALESCE(revoked_at,?),email_payload=NULL WHERE kind='personal' AND id=? AND inviter_id=? AND accepted_by IS NULL",
    )
    .bind(Date.now(), id, actor)
    .run();
}
export async function cleanupInvitationPayloads(db: D1Database) {
  await db
    .prepare(
      `UPDATE invitation SET email_payload=NULL WHERE id IN (
    SELECT i.id FROM invitation i JOIN membership m ON m.user_id=i.inviter_id
    WHERE email_payload IS NOT NULL AND (i.email_attempted_at<? OR i.revoked_at IS NOT NULL OR i.accepted_by IS NOT NULL OR m.status!='active') LIMIT 50
  )`,
    )
    .bind(Date.now() - 23 * 3600000)
    .run();
}

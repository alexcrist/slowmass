import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { newInvitationCredential } from '../../membership';
import type { Env } from '../../env';

export const INVITE_LINK_LIFETIME = 7 * 86_400_000;

async function currentLink(env: Env, member: string) {
  const row = await env.DB.prepare(
    `SELECT id,token_encrypted AS token,expires_at AS expiresAt FROM invite_link
    WHERE inviter_id=? AND revoked_at IS NULL AND expires_at>? AND token_encrypted IS NOT NULL
      AND EXISTS(SELECT 1 FROM membership m JOIN avatar a ON a.user_id=m.user_id
        WHERE m.user_id=invite_link.inviter_id AND m.status='active')`,
  )
    .bind(member, Date.now())
    .first<{ id: string; token: string; expiresAt: number }>();
  if (!row) return null;
  try {
    const token = await symmetricDecrypt({
      key: env.AUTH_SECRET!,
      data: row.token,
    });
    return {
      id: row.id,
      url: `${env.APP_ORIGIN}/#invite/${token}`,
      expiresAt: row.expiresAt,
    };
  } catch {
    // Unreadable after an auth secret rotation; a fresh credential replaces it.
    return { id: row.id, url: null, expiresAt: row.expiresAt };
  }
}

// Opening the owner's dialog extends a current link to seven days from now.
// Keep its credential/version so shared URLs and pending claims still work.
// Expired or revoked links get a fresh version; never resurrect one by extending.
export async function inviteLink(env: Env, member: string) {
  const current = await currentLink(env, member);
  if (current?.url) {
    const now = Date.now();
    const extended = await env.DB.prepare(
      `UPDATE invite_link SET expires_at=MAX(expires_at,?)
      WHERE inviter_id=? AND id=? AND revoked_at IS NULL AND expires_at>?
        AND token_encrypted IS NOT NULL
        AND EXISTS(SELECT 1 FROM membership m JOIN avatar a ON a.user_id=m.user_id
          WHERE m.user_id=invite_link.inviter_id AND m.status='active')
      RETURNING expires_at AS expiresAt`,
    )
      .bind(now + INVITE_LINK_LIFETIME, member, current.id, now)
      .first<{ expiresAt: number }>();
    return extended
      ? { url: current.url, expiresAt: extended.expiresAt }
      : null;
  }
  const credential = await newInvitationCredential();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO invite_link(inviter_id,id,token_hash,token_encrypted,created_at,expires_at)
    SELECT m.user_id,?,?,?,?,? FROM membership m JOIN avatar a ON a.user_id=m.user_id
    WHERE m.user_id=? AND m.status='active'
    ON CONFLICT(inviter_id) DO UPDATE SET id=excluded.id,token_hash=excluded.token_hash,
      token_encrypted=excluded.token_encrypted,created_at=excluded.created_at,
      expires_at=excluded.expires_at,revoked_at=NULL
    WHERE invite_link.expires_at<=? OR invite_link.revoked_at IS NOT NULL
      OR invite_link.token_encrypted IS NULL OR invite_link.id=?`,
  )
    .bind(
      crypto.randomUUID(),
      credential.hash,
      await symmetricEncrypt({ key: env.AUTH_SECRET!, data: credential.token }),
      now,
      now + INVITE_LINK_LIFETIME,
      member,
      now,
      current?.id ?? null,
    )
    .run();
  const issued = await currentLink(env, member);
  return issued?.url ? { url: issued.url, expiresAt: issued.expiresAt } : null;
}

// Claims outlive their link only until the email token expires. Ciphertext of
// expired, revoked, or inactive members' links is cleared; versions and
// hashes stay so joins remain traceable.
export async function cleanupInviteLinks(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'DELETE FROM invite_link_claim WHERE token_hash IN(SELECT token_hash FROM invite_link_claim WHERE expires_at<=? LIMIT 100)',
      )
      .bind(now),
    db
      .prepare(
        `UPDATE invite_link SET token_encrypted=NULL WHERE inviter_id IN(SELECT l.inviter_id FROM invite_link l
        JOIN membership m ON m.user_id=l.inviter_id WHERE l.token_encrypted IS NOT NULL
        AND (l.expires_at<=? OR l.revoked_at IS NOT NULL OR m.status!='active') LIMIT 100)`,
      )
      .bind(now),
  ]);
}

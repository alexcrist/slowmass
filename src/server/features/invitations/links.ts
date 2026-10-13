import { symmetricEncrypt, symmetricDecrypt } from 'better-auth/crypto';
import { newInvitationCredential } from '../../membership';
import type { Env } from '../../env';

export async function currentInviteLink(db: D1Database, actor: string) {
  const row = await db
    .prepare(
      `SELECT l.id,l.expires_at AS expiresAt,l.revoked_at AS revokedAt,
      l.token_encrypted IS NOT NULL AS hasToken FROM invite_link l
      JOIN membership m ON m.user_id=l.inviter_id AND m.status='active'
      JOIN avatar a ON a.user_id=m.user_id WHERE l.inviter_id=?`,
    )
    .bind(actor)
    .first<{
      id: string;
      expiresAt: number;
      revokedAt: number | null;
      hasToken: number;
    }>();
  return row
    ? {
        id: row.id,
        expiresAt: row.expiresAt,
        available:
          row.revokedAt === null &&
          row.expiresAt > Date.now() &&
          Boolean(row.hasToken),
      }
    : null;
}

async function copyInviteLink(env: Env, actor: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT l.token_encrypted AS token,l.expires_at AS expiresAt FROM invite_link l
    JOIN membership m ON m.user_id=l.inviter_id AND m.status='active'
    JOIN avatar a ON a.user_id=m.user_id
    WHERE l.id=? AND l.inviter_id=? AND l.revoked_at IS NULL AND l.expires_at>?`,
  )
    .bind(id, actor, Date.now())
    .first<{ token: string | null; expiresAt: number }>();
  if (!row?.token) return null;
  try {
    return {
      id,
      expiresAt: row.expiresAt,
      url: `${env.APP_ORIGIN}/invite#${await symmetricDecrypt({ key: env.AUTH_SECRET!, data: row.token })}`,
    };
  } catch {
    return null;
  }
}

export async function ensureInviteLink(env: Env, actor: string, id: string) {
  const current = await currentInviteLink(env.DB, actor);
  if (current?.available) return copyInviteLink(env, actor, current.id);
  const credential = await newInvitationCredential();
  const encrypted = await symmetricEncrypt({
    key: env.AUTH_SECRET!,
    data: credential.token,
  });
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO invite_link(inviter_id,id,token_hash,token_encrypted,created_at,expires_at)
    SELECT m.user_id,?,?,?,?,? FROM membership m JOIN avatar a ON a.user_id=m.user_id
    WHERE m.user_id=? AND m.status='active'
    ON CONFLICT(inviter_id) DO UPDATE SET id=excluded.id,token_hash=excluded.token_hash,
      token_encrypted=excluded.token_encrypted,created_at=excluded.created_at,
      expires_at=excluded.expires_at,revoked_at=NULL
    WHERE invite_link.id!=excluded.id AND
      (invite_link.expires_at<=? OR invite_link.revoked_at IS NOT NULL OR invite_link.token_encrypted IS NULL)`,
  )
    .bind(id, credential.hash, encrypted, now, now + 7 * 86400000, actor, now)
    .run();
  // Concurrent copies converge on the winning credential, including other tabs.
  const result = await currentInviteLink(env.DB, actor);
  return result ? copyInviteLink(env, actor, result.id) : null;
}

export async function replaceInviteLink(
  env: Env,
  actor: string,
  id: string,
  expectedId: string,
) {
  const current = await currentInviteLink(env.DB, actor);
  if (current?.id === id) return copyInviteLink(env, actor, id);
  if (!current || current.id !== expectedId || id === expectedId) return null;
  const credential = await newInvitationCredential();
  const encrypted = await symmetricEncrypt({
    key: env.AUTH_SECRET!,
    data: credential.token,
  });
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE invite_link SET id=?,token_hash=?,token_encrypted=?,created_at=?,expires_at=?,revoked_at=NULL
    WHERE inviter_id=? AND id=?
      AND EXISTS(SELECT 1 FROM membership m JOIN avatar a ON a.user_id=m.user_id
        WHERE m.user_id=inviter_id AND m.status='active')`,
  )
    .bind(
      id,
      credential.hash,
      encrypted,
      now,
      now + 7 * 86400000,
      actor,
      expectedId,
    )
    .run();
  return copyInviteLink(env, actor, id);
}

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
        `UPDATE invite_link SET token_encrypted=NULL WHERE id IN(SELECT l.id FROM invite_link l
      JOIN membership m ON m.user_id=l.inviter_id WHERE l.token_encrypted IS NOT NULL
      AND (l.expires_at<=? OR l.revoked_at IS NOT NULL OR m.status!='active') LIMIT 100)`,
      )
      .bind(now),
  ]);
}

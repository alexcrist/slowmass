import { invitationTokenHash } from './credential';
import { bindEventVerification } from './event';
import { bindInviteVerification } from './invite';

export type OAuthClaim = { source: 'event' | 'invite'; token: string };

// This handle never authenticates anyone. Only Better Auth's protected server
// state carries it; the provider-verified email fills the claim on callback.
export async function prepareOAuthClaim(
  db: D1Database,
  source: OAuthClaim['source'],
  link: unknown,
): Promise<OAuthClaim | null> {
  const token = crypto.randomUUID();
  const bound =
    source === 'event'
      ? await bindEventVerification(db, link, '', token, true)
      : await bindInviteVerification(db, link, '', token);
  if (!bound) return null;
  const table = source === 'event' ? 'event_claim' : 'invite_link_claim';
  await db
    .prepare(`UPDATE ${table} SET expires_at=? WHERE token_hash=?`)
    .bind(Date.now() + 600_000, await invitationTokenHash(token))
    .run();
  return { source, token };
}

export async function identifyOAuthClaim(
  db: D1Database,
  claim: OAuthClaim,
  email: string,
) {
  const table = claim.source === 'event' ? 'event_claim' : 'invite_link_claim';
  const hash = await invitationTokenHash(claim.token);
  await db
    .prepare(
      `UPDATE ${table} SET email=? WHERE token_hash=? AND email='' AND expires_at>?`,
    )
    .bind(email, hash, Date.now())
    .run();
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM ${table} WHERE token_hash=? AND email=? AND expires_at>?`,
      )
      .bind(hash, email, Date.now())
      .first(),
  );
}

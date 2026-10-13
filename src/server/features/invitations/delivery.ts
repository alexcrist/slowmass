import type { Env } from '../../env';
import { prepareEmail, sendEmail, type EmailPayload } from '../../email';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { newInvitationCredential } from '../../membership';

export async function deliverInvitation(env: Env, actor: string, id: string) {
  const now = Date.now();
  const invitation = await env.DB.prepare(
    `SELECT i.recipient_email AS email, i.expires_at AS expiresAt,
    i.email_sent_at AS sentAt, i.email_attempted_at AS attemptedAt,
    i.join_token_hash AS tokenHash,i.email_payload IS NOT NULL AS hasPayload,
    p.display_name AS name,p.handle FROM invitation i
    JOIN membership m ON m.user_id=i.inviter_id AND m.status='active'
    JOIN profile p ON p.user_id=i.inviter_id
    WHERE i.kind='personal' AND i.id=? AND i.inviter_id=? AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM user u JOIN membership member ON member.user_id=u.id WHERE u.email=i.recipient_email)`,
  )
    .bind(id, actor, now)
    .first<{
      email: string;
      expiresAt: number;
      sentAt: number | null;
      attemptedAt: number | null;
      tokenHash: string | null;
      hasPayload: number;
      name: string;
      handle: string;
    }>();
  if (!invitation) return 'missing';
  if (invitation.sentAt !== null) return 'sent';
  if (invitation.tokenHash && !invitation.hasPayload) return 'expired';
  // Resend retains deduplication keys for 24 hours; leave a safety margin.
  if (
    invitation.attemptedAt !== null &&
    invitation.attemptedAt <= now - 23 * 3600000
  )
    return 'expired';
  const credential = await newInvitationCredential();
  const joinUrl = `${env.APP_ORIGIN}/join#${credential.token}`;
  const payload = prepareEmail(
    env,
    invitation.email,
    "You're invited to slowmass",
    `${invitation.name.replace(/[\r\n]+/g, ' ')} (@${invitation.handle}) invited you to slowmass.\n\nslowmass is a Seattle-based social media application for sharing photos with friends.\n\nJoin slowmass:\n${joinUrl}\n\nOpen the link and choose Accept invitation to join as ${invitation.email}. No second email or password is needed.\n\nThis personal link works once and expires on ${new Date(invitation.expiresAt).toUTCString()}. Don't forward it: it grants access to your account. You and your inviter will follow each other automatically after you finish setting up your profile.\n\nIf you don't want to join, you can ignore this email.`,
  );
  // Retryable delivery needs the exact first email. Encrypt its credential at
  // rest with Better Auth's authenticated encryption, then discard after send.
  const encrypted = await symmetricEncrypt({
    key: env.AUTH_SECRET!,
    data: JSON.stringify(payload),
  });
  const claimed = await env.DB.prepare(
    `UPDATE invitation SET email_payload=CASE WHEN join_token_hash IS NULL THEN ? ELSE email_payload END,
    join_token_hash=COALESCE(join_token_hash,?),
    email_attempted_at=COALESCE(email_attempted_at,?),email_last_attempt_at=?
    WHERE kind='personal' AND id=? AND inviter_id=? AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at>?
    AND email_sent_at IS NULL AND (email_last_attempt_at IS NULL OR email_last_attempt_at<?)
    AND (email_attempted_at IS NULL OR email_attempted_at>?)
    AND (join_token_hash IS NULL OR email_payload IS NOT NULL)
    AND EXISTS(SELECT 1 FROM membership WHERE user_id=inviter_id AND status='active')
    AND NOT EXISTS(SELECT 1 FROM user u JOIN membership member ON member.user_id=u.id WHERE u.email=invitation.recipient_email)
    RETURNING email_payload AS payload`,
  )
    .bind(
      encrypted,
      credential.hash,
      now,
      now,
      id,
      actor,
      now,
      now - 60000,
      now - 23 * 3600000,
    )
    .first<{ payload: string }>();
  if (!claimed) return 'pending';
  try {
    if (
      !(await sendEmail(
        env,
        JSON.parse(
          await symmetricDecrypt({
            key: env.AUTH_SECRET!,
            data: claimed.payload,
          }),
        ) as EmailPayload,
        `invitation-join/${id}`,
      ))
    )
      return 'limited';
    await env.DB.prepare(
      'UPDATE invitation SET email_sent_at=COALESCE(email_sent_at,?),email_payload=NULL WHERE id=?',
    )
      .bind(Date.now(), id)
      .run();
    return 'sent';
  } catch {
    // A timeout can still mean the provider accepted it. Retry the frozen payload/key.
    return 'failed';
  }
}

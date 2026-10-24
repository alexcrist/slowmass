import { AwsClient } from 'aws4fetch';
import type { Env } from '../env';
import { SIGN_IN_LINK_HOURS } from '../../shared/sign-in';

const SES_REGION = 'us-west-2';
const SES_ENDPOINT = `https://email.${SES_REGION}.amazonaws.com/v2/email/outbound-emails`;

export function emailConfigured(env: Env): boolean {
  return Boolean(
    env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY && env.EMAIL_FROM,
  );
}

export async function sendLoginEmail(
  env: Env,
  email: string,
  url: string,
): Promise<void> {
  if (!emailConfigured(env))
    throw new Error('Email delivery is not configured');
  const link = new URL(url);
  if (
    link.origin !== env.APP_ORIGIN ||
    link.pathname !== '/api/auth/magic-link/verify'
  )
    throw new Error('Invalid sign-in link origin');
  await sendEmail(
    env,
    email,
    'Your slowmass sign-in link',
    `Use this link to confirm your email and sign in to slowmass:\n\n${url}\n\nIt expires in ${SIGN_IN_LINK_HOURS} hours and can be used once. If you did not request it, you can ignore this email.`,
  );
}

async function sendEmail(
  env: Env,
  email: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const now = Date.now();
  const hash = await recipientHash(email);
  // Conservative reservations count failed sends too. Total spending is capped
  // outside the app by the AWS budget action described in docs/setup.md.
  const [reservation] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO email_budget (budget_key, used, expires_at) VALUES (?, 1, ?)
    ON CONFLICT (budget_key) DO UPDATE SET used = used + 1 WHERE used < 3`,
    ).bind(
      `recipient:${hash}:${Math.floor(now / 3600000)}`,
      now + 2 * 86400000,
    ),
    env.DB.prepare('DELETE FROM email_budget WHERE expires_at < ?').bind(now),
  ]);
  if (!reservation.meta.changes) return false;
  const response = await deliver(env, email, subject, text);
  if (!response.ok) throw new Error('Email delivery failed');
  return true;
}

async function recipientHash(email: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(email.trim().toLowerCase()),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Notification email never uses the sign-in budget, so it cannot block
// sign-in mail. These daily caps bound its cost and per-member volume.
export const NOTIFICATION_EMAILS_PER_MEMBER_DAY = 30;
export const NOTIFICATION_EMAILS_PER_DAY = 5000;

// Sends one notification email with one-click unsubscribe headers (RFC 8058).
// An SES error response is a definite rejection; a timeout or network error
// may still have delivered, so the caller must not resend after 'unknown'.
export async function sendNotificationEmail(
  env: Env,
  message: { to: string; subject: string; text: string; unsubscribe: string },
): Promise<'sent' | 'rejected' | 'unknown' | 'throttled'> {
  if (!emailConfigured(env)) return 'throttled';
  if (new URL(message.unsubscribe).origin !== env.APP_ORIGIN)
    throw new Error('Invalid unsubscribe link origin');
  const now = Date.now();
  const day = Math.floor(now / 86400000);
  const reserve = (key: string, limit: number) =>
    env.DB.prepare(
      `INSERT INTO email_budget (budget_key, used, expires_at) VALUES (?, 1, ?)
      ON CONFLICT (budget_key) DO UPDATE SET used = used + 1 WHERE used < ?`,
    ).bind(key, now + 2 * 86400000, limit);
  const [everyone, member] = await env.DB.batch([
    reserve(`notify:all:${day}`, NOTIFICATION_EMAILS_PER_DAY),
    reserve(
      `notify:${await recipientHash(message.to)}:${day}`,
      NOTIFICATION_EMAILS_PER_MEMBER_DAY,
    ),
  ]);
  if (!everyone.meta.changes || !member.meta.changes) return 'throttled';
  let response: Response;
  try {
    response = await deliver(env, message.to, message.subject, message.text, [
      { Name: 'List-Unsubscribe', Value: `<${message.unsubscribe}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'email.send_failed',
        errorType: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    return 'unknown';
  }
  return response.ok ? 'sent' : 'rejected';
}

// SES requires a 7-bit subject; names and titles may not be, so non-ASCII
// subjects use RFC 2047 encoded words of at most 45 bytes each.
export function encodeSubject(subject: string) {
  const text = subject.replace(/\s+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = '';
  const encoder = new TextEncoder();
  const word = (value: string) =>
    `=?UTF-8?B?${btoa(String.fromCharCode(...encoder.encode(value)))}?=`;
  for (const character of text) {
    if (encoder.encode(chunk + character).length > 45) {
      words.push(word(chunk));
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(word(chunk));
  return words.join(' ');
}

async function deliver(
  env: Env,
  email: string,
  subject: string,
  text: string,
  headers: { Name: string; Value: string }[] = [],
) {
  const ses = new AwsClient({
    accessKeyId: env.SES_ACCESS_KEY_ID!,
    secretAccessKey: env.SES_SECRET_ACCESS_KEY!,
    service: 'ses',
    region: SES_REGION,
    // SES has no idempotency key, so a retried request could deliver twice.
    retries: 0,
  });
  const request = await ses.sign(SES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      FromEmailAddress: env.EMAIL_FROM,
      Destination: { ToAddresses: [email] },
      ...(env.EMAIL_REPLY_TO ? { ReplyToAddresses: [env.EMAIL_REPLY_TO] } : {}),
      Content: {
        Simple: {
          Subject: { Data: encodeSubject(subject), Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' } },
          ...(headers.length ? { Headers: headers } : {}),
        },
      },
    }),
  });
  const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
  if (!response.ok)
    // SES error messages can echo addresses; log only the status and error type.
    console.error(
      'SES delivery failed',
      response.status,
      response.headers.get('x-amzn-ErrorType'),
    );
  await response.body?.cancel();
  return response;
}

export async function cleanupEmailBudgets(db: D1Database) {
  await db
    .prepare(
      'DELETE FROM email_budget WHERE budget_key IN(SELECT budget_key FROM email_budget WHERE expires_at<? LIMIT 100)',
    )
    .bind(Date.now())
    .run();
}

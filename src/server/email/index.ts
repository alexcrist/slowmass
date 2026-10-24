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
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(email.trim().toLowerCase()),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' } },
        },
      },
    }),
  });
  const response = await fetch(request, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    // SES error messages can echo addresses; log only the status and error type.
    console.error(
      'SES delivery failed',
      response.status,
      response.headers.get('x-amzn-ErrorType'),
    );
    throw new Error('Email delivery failed');
  }
  return true;
}

export async function cleanupEmailBudgets(db: D1Database) {
  await db
    .prepare(
      'DELETE FROM email_budget WHERE budget_key IN(SELECT budget_key FROM email_budget WHERE expires_at<? LIMIT 100)',
    )
    .bind(Date.now())
    .run();
}

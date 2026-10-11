import type { Env } from '../env';

export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
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
  const reserve = (key: string, limit: number) =>
    env.DB.prepare(
      `INSERT INTO email_budget (budget_key, used, expires_at) VALUES (?, 1, ?)
    ON CONFLICT (budget_key) DO UPDATE SET used = used + 1 WHERE used < ?`,
    ).bind(key, now + 2 * 86400000, limit);
  // Conservative reservations count failed sends too. They never exceed the free daily ceiling.
  const reservations = await env.DB.batch([
    reserve(`day:${Math.floor(now / 86400000)}`, 80),
    reserve(`recipient:${hash}:${Math.floor(now / 3600000)}`, 3),
    env.DB.prepare('DELETE FROM email_budget WHERE expires_at < ?').bind(now),
  ]);
  if (!reservations[0].meta.changes || !reservations[1].meta.changes) return;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      reply_to: env.EMAIL_REPLY_TO || undefined,
      to: [email],
      subject: 'Your Slowmass sign-in link',
      text: `Use this link to confirm your email and sign in to Slowmass:\n\n${url}\n\nIt expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Email delivery failed');
}

import { authDate } from '../../auth';
import type { Env } from '../../env';

export function pushConfigured(env: Env) {
  return Boolean(env.PUSH_PUBLIC_KEY && env.PUSH_PRIVATE_KEY);
}
export type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function validEndpoint(endpoint: string) {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' ||
        url.hostname.endsWith('.push.apple.com') ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
function validKey(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value))
    return false;
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === length;
  } catch {
    return false;
  }
}
export async function parseSubscription(
  value: unknown,
): Promise<Subscription | null> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('endpoint' in value) ||
    typeof value.endpoint !== 'string' ||
    !validEndpoint(value.endpoint) ||
    !('keys' in value) ||
    !value.keys ||
    typeof value.keys !== 'object' ||
    !('p256dh' in value.keys) ||
    !('auth' in value.keys) ||
    !validKey(value.keys.p256dh, 65) ||
    !validKey(value.keys.auth, 16)
  )
    return null;
  const subscription = value as Subscription;
  try {
    await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(
        atob(subscription.keys.p256dh.replace(/-/g, '+').replace(/_/g, '/')),
        (char) => char.charCodeAt(0),
      ),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    return null;
  }
  return subscription;
}
// Undefined selects the legacy session-wide API; null means no local subscription.
export async function subscriptionStatus(
  db: D1Database,
  user: string,
  session: string,
  endpoint?: string | null,
) {
  return db
    .prepare(
      `SELECT id,endpoint FROM push_subscription WHERE user_id=? AND session_id=?
    AND ${endpoint === undefined ? '(SELECT COUNT(*) FROM push_subscription WHERE session_id=?)=1' : 'endpoint=?'}`,
    )
    .bind(user, session, endpoint === undefined ? session : endpoint)
    .first<{ id: string; endpoint: string }>();
}
export async function saveSubscription(
  db: D1Database,
  user: string,
  session: string,
  subscription: Subscription,
) {
  // Endpoint identity is unique; ownership still requires this member/session.
  const result = await db
    .prepare(
      `
    INSERT INTO push_subscription(id,user_id,session_id,endpoint,p256dh,auth,created_at)
    SELECT ?,?,?,?,?,?,? FROM session a JOIN membership m ON m.user_id=a.userId
    WHERE a.id=? AND a.userId=? AND a.expiresAt>? AND m.status='active'
      AND ((SELECT COUNT(*) FROM push_subscription WHERE user_id=?)<10
        OR EXISTS(SELECT 1 FROM push_subscription WHERE user_id=? AND session_id=? AND endpoint=?))
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at
    WHERE push_subscription.user_id=excluded.user_id AND push_subscription.session_id=excluded.session_id
  `,
    )
    .bind(
      crypto.randomUUID(),
      user,
      session,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      Date.now(),
      session,
      user,
      authDate(),
      user,
      user,
      session,
      subscription.endpoint,
    )
    .run();
  return result.meta.changes > 0;
}
export async function removeSubscription(
  db: D1Database,
  user: string,
  session: string,
  endpoint: string,
) {
  await db
    .prepare(
      'DELETE FROM push_subscription WHERE user_id=? AND session_id=? AND endpoint=?',
    )
    .bind(user, session, endpoint)
    .run();
}
// Any live subscription on another device or browser, for install guidance.
export async function hasPushSubscription(db: D1Database, user: string) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM push_subscription s JOIN session a ON a.id=s.session_id
    WHERE s.user_id=? AND a.expiresAt>? LIMIT 1`,
      )
      .bind(user, authDate())
      .first(),
  );
}

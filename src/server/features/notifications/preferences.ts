import { constantTimeEqual, makeSignature } from 'better-auth/crypto';
import {
  isNotificationCategory,
  notificationCategories,
  type NotificationCategory,
} from '../../../shared/notification-categories';

export type NotificationPreference = {
  category: NotificationCategory;
  push: boolean;
  email: boolean;
};

// Effective choices: a saved preference, or the category's default.
export async function readPreferences(
  db: D1Database,
  user: string,
): Promise<NotificationPreference[]> {
  const rows = await db
    .prepare(
      `SELECT c.id AS category,COALESCE(p.push,c.push) AS push,COALESCE(p.email,c.email) AS email
      FROM notification_category c
      LEFT JOIN notification_preference p ON p.user_id=? AND p.category=c.id`,
    )
    .bind(user)
    .all<{ category: string; push: number; email: number }>();
  const saved = new Map(rows.results.map((row) => [row.category, row]));
  return notificationCategories.flatMap(({ id }) => {
    const row = saved.get(id);
    return row
      ? [{ category: id, push: Boolean(row.push), email: Boolean(row.email) }]
      : [];
  });
}

export function parsePreference(value: unknown): NotificationPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { category, push, email } = value as Record<string, unknown>;
  return isNotificationCategory(category) &&
    typeof push === 'boolean' &&
    typeof email === 'boolean'
    ? { category, push, email }
    : null;
}

// Saving the same choice again is harmless, so retries need no identifier.
export async function savePreference(
  db: D1Database,
  user: string,
  preference: NotificationPreference,
) {
  const result = await db
    .prepare(
      `INSERT INTO notification_preference(user_id,category,push,email)
      SELECT user_id,?,?,? FROM membership WHERE user_id=? AND status='active'
      ON CONFLICT(user_id,category) DO UPDATE SET push=excluded.push,email=excluded.email`,
    )
    .bind(
      preference.category,
      Number(preference.push),
      Number(preference.email),
      user,
    )
    .run();
  return result.meta.changes > 0;
}

// An unsubscribe token names one member and category and is an HMAC under
// AUTH_SECRET, so each email can stop only its own category without signing
// in. It never expires; rotating AUTH_SECRET invalidates every link.
async function signature(secret: string, user: string, category: string) {
  return (
    await makeSignature(`notification-unsubscribe:${user}:${category}`, secret)
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export async function unsubscribeToken(
  secret: string,
  user: string,
  category: NotificationCategory,
) {
  return `${user}.${category}.${await signature(secret, user, category)}`;
}
async function verifyToken(secret: string, token: string) {
  const match =
    /^([A-Za-z0-9-]{1,64})\.([a-z_]{1,32})\.([A-Za-z0-9_-]{40,64})$/.exec(
      token,
    );
  if (!match || !isNotificationCategory(match[2])) return null;
  const [, user, category, given] = match;
  return constantTimeEqual(given, await signature(secret, user, category))
    ? { user, category }
    : null;
}

// Turns email off for the token's category, keeping its push choice. Returns
// the category, or null for an invalid token or inactive member.
export async function unsubscribe(
  db: D1Database,
  secret: string,
  token: string,
) {
  const verified = await verifyToken(secret, token);
  if (!verified) return null;
  const result = await db
    .prepare(
      `INSERT INTO notification_preference(user_id,category,push,email)
      SELECT m.user_id,c.id,COALESCE(p.push,c.push),0 FROM membership m
      JOIN notification_category c ON c.id=?
      LEFT JOIN notification_preference p ON p.user_id=m.user_id AND p.category=c.id
      WHERE m.user_id=? AND m.status='active'
      ON CONFLICT(user_id,category) DO UPDATE SET email=0`,
    )
    .bind(verified.category, verified.user)
    .run();
  return result.meta.changes > 0 ? verified.category : null;
}

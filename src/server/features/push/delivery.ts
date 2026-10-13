import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from '../../env';
import { isUnreadNotification } from '../notifications';
import { pushConfigured, validEndpoint } from './subscriptions';

type Delivery = {
  subscription_id: string;
  event_key: string;
  version: number;
  attempts: number;
  lease: string;
};
type Target = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function finish(db: D1Database, item: Delivery) {
  await db
    .prepare(
      'DELETE FROM push_delivery WHERE subscription_id=? AND event_key=? AND version=? AND lease=?',
    )
    .bind(item.subscription_id, item.event_key, item.version, item.lease)
    .run();
}
async function target(db: D1Database, item: Delivery) {
  return db
    .prepare(
      `SELECT s.user_id,s.endpoint,s.p256dh,s.auth FROM push_subscription s
    JOIN session a ON a.id=s.session_id AND a.userId=s.user_id
    JOIN membership m ON m.user_id=s.user_id
    WHERE s.id=? AND a.expiresAt>? AND m.status='active'
      AND EXISTS(SELECT 1 FROM push_delivery d WHERE d.subscription_id=s.id AND d.event_key=? AND d.version=? AND d.lease=?)
  `,
    )
    .bind(
      item.subscription_id,
      Date.now(),
      item.event_key,
      item.version,
      item.lease,
    )
    .first<Target>();
}
async function send(env: Env, item: Delivery) {
  const subscription = await target(env.DB, item);
  if (
    !subscription ||
    !validEndpoint(subscription.endpoint) ||
    !(await isUnreadNotification(env.DB, subscription.user_id, {
      key: item.event_key,
      version: item.version,
    }))
  ) {
    await finish(env.DB, item);
    return;
  }
  let retryAfter = 0;
  try {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(item.event_key),
      ),
    );
    const topic = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .slice(0, 32);
    // Generic text avoids leaking names, comment bodies or photos in a delayed
    // lock-screen delivery after logout/revocation. Activity reauthorizes detail.
    const request = await buildPushPayload(
      {
        data: {
          key: item.event_key,
          version: item.version,
          subscriptionId: item.subscription_id,
        },
        options: { ttl: 3600, urgency: 'normal', topic },
      },
      {
        endpoint: subscription.endpoint,
        expirationTime: null,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      {
        subject: env.APP_ORIGIN,
        publicKey: env.PUSH_PUBLIC_KEY!,
        privateKey: env.PUSH_PRIVATE_KEY!,
      },
    );
    const response = await fetch(subscription.endpoint, {
      ...request,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (response.ok) {
      await finish(env.DB, item);
      return;
    }
    if (response.status === 404 || response.status === 410) {
      // Match the exact endpoint so a late response cannot remove a replacement.
      await env.DB.prepare(
        'DELETE FROM push_subscription WHERE id=? AND endpoint=?',
      )
        .bind(item.subscription_id, subscription.endpoint)
        .run();
      return;
    }
    if (response.status === 429) {
      const value = response.headers.get('Retry-After');
      retryAfter = value
        ? /^\d+$/.test(value)
          ? Number(value) * 1000
          : Date.parse(value) - Date.now()
        : 0;
    }
    if (
      response.status >= 300 &&
      response.status < 500 &&
      ![401, 403, 408, 429].includes(response.status)
    ) {
      await finish(env.DB, item);
      return;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'push.send_failed',
        errorType: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    // Network timeouts are ambiguous. Topic/tag replacement limits duplicates.
  }
  const delay = Math.max(
    Math.min(3_600_000, 30_000 * 2 ** (item.attempts - 1)),
    Math.max(0, Number.isFinite(retryAfter) ? retryAfter : 0),
  );
  await env.DB.prepare(
    `UPDATE push_delivery SET available_at=?,lease=NULL,lease_until=0
    WHERE subscription_id=? AND event_key=? AND version=? AND lease=?`,
  )
    .bind(
      Date.now() + delay,
      item.subscription_id,
      item.event_key,
      item.version,
      item.lease,
    )
    .run();
}
export async function dispatchPush(env: Env) {
  if (!pushConfigured(env) || env.MAINTENANCE_MODE === 'true') return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM push_delivery WHERE rowid IN(
      SELECT rowid FROM push_delivery WHERE attempts>=8 AND lease_until<? LIMIT 100
    )`,
    ).bind(now),
    env.DB.prepare(
      `DELETE FROM push_delivery WHERE rowid IN(
      SELECT rowid FROM push_delivery WHERE created_at<? ORDER BY created_at LIMIT 100
    )`,
    ).bind(now - 86_400_000),
  ]);
  const lease = crypto.randomUUID();
  const rows = await env.DB.prepare(
    `UPDATE push_delivery SET lease=?,lease_until=?,attempts=attempts+1
    WHERE rowid IN(SELECT rowid FROM push_delivery WHERE available_at<=? AND lease_until<=? AND attempts<8 ORDER BY available_at LIMIT 5)
    RETURNING subscription_id,event_key,version,attempts,lease
  `,
  )
    .bind(lease, now + 60_000, now, now)
    .all<Delivery>();
  const results = await Promise.allSettled(
    rows.results.map((item) => send(env, item)),
  );
  if (results.some((result) => result.status === 'rejected'))
    console.error(JSON.stringify({ event: 'push.dispatch_failed' }));
}

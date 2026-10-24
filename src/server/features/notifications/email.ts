import type { Env } from '../../env';
import { emailConfigured, sendNotificationEmail } from '../../email';
import { notificationCategoryLabel } from '../../../shared/notification-categories';
import { describeNotification, type DescribedNotification } from './activity';
import { notificationText } from './text';
import { unsubscribeToken } from './preferences';
import { alertAllowed, cleanupAlerts, recordAlert } from './alerts';

// Emails per dispatch pass, each one SES request. Together with push this
// stays well inside the Worker's per-invocation subrequest allowance.
const EMAILS_PER_PASS = 20;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

type Delivery = {
  recipient: string;
  key: string;
  version: number | null;
  attempts: number;
};

// A host's copy of their own update blast has no Activity source, so it
// rechecks the blast itself: undeleted, from an active host, on a published
// event whose creator is active.
async function describeBlastCopy(
  db: D1Database,
  author: string,
  key: string,
): Promise<DescribedNotification | null> {
  const row = await db
    .prepare(
      `SELECT ev.id AS eventId,ev.title AS eventTitle,p.display_name AS displayName,
        p.handle,msg.body,COALESCE(np.email,c.email) AS email
      FROM event_message msg
      JOIN event ev ON ev.id=msg.event_id AND ev.state='published'
      JOIN membership cm ON cm.user_id=ev.creator_id AND cm.status='active'
      JOIN membership am ON am.user_id=msg.user_id AND am.status='active'
      JOIN profile p ON p.user_id=msg.user_id
      JOIN notification_category c ON c.id='update_blast'
      LEFT JOIN notification_preference np ON np.user_id=msg.user_id AND np.category=c.id
      WHERE msg.id=? AND msg.user_id=? AND msg.blast=1 AND msg.deleted_at IS NULL`,
    )
    .bind(key.slice('event_message:'.length), author)
    .first<{
      eventId: string;
      eventTitle: string;
      displayName: string;
      handle: string;
      body: string;
      email: number;
    }>();
  return row
    ? {
        ...row,
        key,
        kind: 'event_message',
        category: 'update_blast',
        postId: null,
        response: null,
        count: 1,
        unread: true,
        push: false,
        email: Boolean(row.email),
      }
    : null;
}

function emailBody(
  origin: string,
  item: DescribedNotification,
  unsubscribe: string,
  copy: boolean,
) {
  const text = notificationText(item);
  const lines = [
    copy ? `You sent this update blast about ${item.eventTitle}.` : '',
    text.summary,
    text.quote ?? '',
    `Open slowmass: ${origin}/${text.path}`,
    [
      'Replies to this email go to slowmass, not to other members.',
      `Stop emails about ${notificationCategoryLabel(item.category).toLowerCase()}: ${unsubscribe}`,
      `Notification settings: ${origin}/#notification-settings`,
    ].join('\n'),
  ];
  return {
    subject: text.summary,
    text: lines.filter(Boolean).join('\n\n'),
  };
}

async function finish(db: D1Database, item: Delivery, lease: string) {
  await db
    .prepare(
      'DELETE FROM email_delivery WHERE recipient_id=? AND event_key=? AND lease=?',
    )
    .bind(item.recipient, item.key, lease)
    .run();
}

async function send(env: Env, secret: string, item: Delivery, lease: string) {
  const recipient = await env.DB.prepare(
    `SELECT u.email FROM user u JOIN membership m ON m.user_id=u.id AND m.status='active'
    WHERE u.id=? AND u.emailVerified=1`,
  )
    .bind(item.recipient)
    .first<string>('email');
  const described = !recipient
    ? null
    : item.version === null
      ? await describeBlastCopy(env.DB, item.recipient, item.key)
      : await describeNotification(
          env.DB,
          item.recipient,
          item.key,
          item.version,
        );
  // Activity already read in the app is not emailed, except update blasts,
  // which are announcements everyone receives.
  const alert = {
    recipient: item.recipient,
    key: item.key,
    version: item.version,
    channel: 'email' as const,
  };
  if (
    !recipient ||
    !described?.email ||
    (!described.unread && described.category !== 'update_blast') ||
    !(await alertAllowed(env.DB, alert))
  ) {
    await finish(env.DB, item, lease);
    return;
  }
  // The page link confirms in the app; the header link is RFC 8058 one-click.
  const token = await unsubscribeToken(
    secret,
    item.recipient,
    described.category,
  );
  const result = await sendNotificationEmail(env, {
    to: recipient,
    ...emailBody(
      env.APP_ORIGIN,
      described,
      `${env.APP_ORIGIN}/#unsubscribe/${token}`,
      item.version === null,
    ),
    unsubscribe: `${env.APP_ORIGIN}/api/unsubscribe/${token}`,
  });
  if (result === 'sent' || result === 'unknown')
    await recordAlert(env.DB, alert);
  // Only a definite SES rejection is retried, after one and then ten minutes.
  // Anything that may have delivered, or a full daily budget, ends the row.
  if (result === 'rejected' && item.attempts < MAX_ATTEMPTS)
    await env.DB.prepare(
      `UPDATE email_delivery SET lease=NULL,lease_until=0,available_at=?
      WHERE recipient_id=? AND event_key=? AND lease=?`,
    )
      .bind(
        Date.now() + 60_000 * 10 ** (item.attempts - 1),
        item.recipient,
        item.key,
        lease,
      )
      .run();
  else await finish(env.DB, item, lease);
}

// Runs after notifying mutations and from the minute cron. A claimed row is
// never claimed again unless SES rejected it, so a timeout or a pass that
// stops mid-send cannot email twice: its abandoned claim is dropped instead.
// Rows older than a day are dropped rather than sent late.
export async function dispatchEmailNotifications(env: Env) {
  if (env.MAINTENANCE_MODE === 'true') return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM email_delivery WHERE rowid IN(SELECT rowid FROM email_delivery
      WHERE created_at<? ORDER BY created_at LIMIT 100)`,
    ).bind(now - DAY),
    env.DB.prepare(
      `DELETE FROM email_delivery WHERE rowid IN(SELECT rowid FROM email_delivery
      WHERE available_at<=? AND ((lease IS NOT NULL AND lease_until<?) OR (lease IS NULL AND attempts>=${MAX_ATTEMPTS})) LIMIT 100)`,
    ).bind(now, now),
  ]);
  await cleanupAlerts(env.DB);
  // Without email configured (local development), rows simply expire.
  if (!emailConfigured(env) || !env.AUTH_SECRET) return;
  const secret = env.AUTH_SECRET;
  const lease = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    `UPDATE email_delivery SET lease=?,lease_until=?,attempts=attempts+1
    WHERE rowid IN(SELECT rowid FROM email_delivery
      WHERE available_at<=? AND lease IS NULL AND attempts<${MAX_ATTEMPTS}
      ORDER BY available_at LIMIT ${EMAILS_PER_PASS})
    RETURNING recipient_id AS recipient,event_key AS key,version,attempts`,
  )
    .bind(lease, now + 120_000, now)
    .all<Delivery>();
  for (const item of claimed.results) {
    try {
      await send(env, secret, item, lease);
    } catch {
      console.error(JSON.stringify({ event: 'email.dispatch_failed' }));
    }
  }
}

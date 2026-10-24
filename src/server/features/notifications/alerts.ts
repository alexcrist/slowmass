// At most one alert per member, notification and channel each hour. Another
// device receiving the same version is the same alert, so it is allowed.
const COOLDOWN = 3_600_000;
type Alert = {
  recipient: string;
  key: string;
  version: number | null;
  channel: 'push' | 'email';
};

export async function alertAllowed(db: D1Database, alert: Alert) {
  const last = await db
    .prepare(
      'SELECT version,sent_at FROM notification_alert WHERE recipient_id=? AND event_key=? AND channel=?',
    )
    .bind(alert.recipient, alert.key, alert.channel)
    .first<{ version: number | null; sent_at: number }>();
  return (
    !last ||
    last.version === alert.version ||
    last.sent_at <= Date.now() - COOLDOWN
  );
}
export async function recordAlert(db: D1Database, alert: Alert) {
  await db
    .prepare(
      `INSERT INTO notification_alert(recipient_id,event_key,channel,version,sent_at) VALUES(?,?,?,?,?)
      ON CONFLICT(recipient_id,event_key,channel) DO UPDATE SET
        version=excluded.version,sent_at=excluded.sent_at
      WHERE notification_alert.version IS NOT excluded.version`,
    )
    .bind(alert.recipient, alert.key, alert.channel, alert.version, Date.now())
    .run();
}
export async function cleanupAlerts(db: D1Database) {
  await db
    .prepare(
      `DELETE FROM notification_alert WHERE rowid IN(SELECT rowid FROM notification_alert
      WHERE sent_at<? ORDER BY sent_at LIMIT 100)`,
    )
    .bind(Date.now() - COOLDOWN)
    .run();
}

import { releaseStorage } from '../../photos/storage';
export async function cleanupAvatars(db: D1Database, bucket: R2Bucket) {
  const now = Date.now();
  const due = await db
    .prepare(
      "SELECT object_key FROM photo_cleanup WHERE object_key LIKE 'avatars/%' AND not_before <= ? ORDER BY not_before LIMIT 2",
    )
    .bind(now)
    .all<{ object_key: string }>();
  for (const row of due.results) {
    // Never delete a key still referenced by a current avatar, even if an earlier cleanup entry survived.
    if (
      await db
        .prepare('SELECT 1 FROM avatar WHERE object_key=? OR large_key=?')
        .bind(row.object_key, row.object_key)
        .first()
    ) {
      await db
        .prepare('DELETE FROM photo_cleanup WHERE object_key=?')
        .bind(row.object_key)
        .run();
      continue;
    }
    try {
      await bucket.delete(row.object_key);
      await releaseStorage(db, row.object_key);
      await db
        .prepare('DELETE FROM photo_cleanup WHERE object_key=?')
        .bind(row.object_key)
        .run();
    } catch {
      /* Retain durable intent for the next scheduled pass. */
    }
  }
  await db
    .prepare(
      'DELETE FROM photo_attempt WHERE id IN (SELECT id FROM photo_attempt WHERE created_at < ? LIMIT 100)',
    )
    .bind(now - 60 * 86400000)
    .run();
}

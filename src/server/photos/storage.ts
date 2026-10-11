import { MAX_PHOTO_BYTES, PhotoError } from './index';
export async function readPhoto(request: Request) {
  if (!request.body) throw new PhotoError('Choose a photo.', 422);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PHOTO_BYTES) {
      await reader.cancel();
      throw new PhotoError('Choose a photo smaller than 8 MB.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function reservePhoto(db: D1Database, userId: string, id: string) {
  const now = Date.now();
  const date = new Date(now);
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const day = now - 86400000;
  const result = await db
    .prepare(
      `INSERT INTO photo_attempt (id,user_id,created_at,state)
    SELECT p.user_id || ':' || ?, p.user_id, ?, 'pending' FROM profile p JOIN membership m ON m.user_id=p.user_id
    WHERE p.user_id=? AND m.status='active'
    AND (SELECT COUNT(*) FROM photo_attempt WHERE created_at >= ?) < 3500
    AND (SELECT COUNT(*) FROM photo_attempt WHERE created_at >= ?) < 150
    AND (SELECT COUNT(*) FROM photo_attempt WHERE user_id=? AND created_at >= ?) < 5
    ON CONFLICT DO NOTHING`,
    )
    .bind(id, now, userId, month, day, userId, day)
    .run();
  if (result.meta.changes) return 'reserved';
  const prior = await db
    .prepare('SELECT state FROM photo_attempt WHERE id=? AND user_id=?')
    .bind(`${userId}:${id}`, userId)
    .first<{ state: string }>();
  return prior?.state ?? 'quota';
}

// The conditional counter update and object reservation commit atomically in D1.
// Reserved, stored, and queued-for-deletion objects all count until R2 confirms deletion.
export async function reserveStorage(
  db: D1Database,
  userId: string,
  key: string,
  bytes: number,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_PHOTO_BYTES)
    throw new PhotoError('Invalid processed photo size.', 413);
  const result = await db.batch([
    db
      .prepare(
        `UPDATE storage_budget SET used_bytes=used_bytes+? WHERE id=1 AND used_bytes+?<=limit_bytes
 AND EXISTS(SELECT 1 FROM membership WHERE user_id=? AND status='active')
 AND NOT EXISTS(SELECT 1 FROM stored_object WHERE object_key=?)
 AND COALESCE((SELECT SUM(bytes) FROM stored_object WHERE user_id=?),0)+?<=250000000`,
      )
      .bind(bytes, bytes, userId, key, userId, bytes),
    db
      .prepare(
        'INSERT INTO stored_object(object_key,user_id,bytes,created_at) SELECT ?,?,?,? WHERE changes()=1',
      )
      .bind(key, userId, bytes, Date.now()),
    db
      .prepare(
        'INSERT INTO photo_cleanup(object_key,not_before) SELECT ?,? WHERE changes()=1 ON CONFLICT(object_key) DO UPDATE SET not_before=MAX(not_before,excluded.not_before)',
      )
      .bind(key, Date.now() + 3600000),
  ]);
  if (!result[0].meta.changes)
    throw new PhotoError(
      'Photo storage limit reached. Delete photos and allow time for cleanup before trying again.',
      503,
    );
}
export async function releaseStorage(db: D1Database, key: string) {
  await db.batch([
    db
      .prepare(
        'UPDATE storage_budget SET used_bytes=used_bytes-COALESCE((SELECT bytes FROM stored_object WHERE object_key=?),0) WHERE id=1',
      )
      .bind(key),
    db.prepare('DELETE FROM stored_object WHERE object_key=?').bind(key),
  ]);
}

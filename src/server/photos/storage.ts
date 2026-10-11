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

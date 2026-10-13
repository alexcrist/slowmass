// Old encrypted backups predate additional photo sizes and must remain restorable.
export function requiredPhotoKeys(db) {
  const thumbnails = db
    .prepare('PRAGMA table_info(post)')
    .all()
    .some((column) => column.name === 'thumbnail_key');
  const largeAvatars = db
    .prepare('PRAGMA table_info(avatar)')
    .all()
    .some((column) => column.name === 'large_key');
  return db
    .prepare(
      "SELECT object_key FROM post WHERE state='published' UNION SELECT object_key FROM avatar" +
        (thumbnails
          ? " UNION SELECT thumbnail_key AS object_key FROM post WHERE state='published' AND thumbnail_key IS NOT NULL"
          : '') +
        (largeAvatars
          ? ' UNION SELECT large_key AS object_key FROM avatar WHERE large_key IS NOT NULL'
          : ''),
    )
    .all();
}

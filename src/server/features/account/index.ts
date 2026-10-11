export async function deleteAccount(db: D1Database, id: string) {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO account_deletion(user_id,requested_at,email_to_redact) SELECT id,?,lower(email) FROM user WHERE id=? ON CONFLICT DO NOTHING',
      )
      .bind(now, id),
    db
      .prepare("UPDATE membership SET status='deleted' WHERE user_id=?")
      .bind(id),
    db
      .prepare(
        'UPDATE invitation SET revoked_at=COALESCE(revoked_at,?) WHERE recipient_email=(SELECT lower(email) FROM user WHERE id=?) AND accepted_by IS NULL',
      )
      .bind(now, id),
    db
      .prepare(
        "DELETE FROM verification WHERE json_valid(value) AND lower(json_extract(value,'$.email'))=(SELECT lower(email) FROM user WHERE id=?)",
      )
      .bind(id),
    db.prepare('DELETE FROM session WHERE userId=?').bind(id),
    db.prepare('DELETE FROM account WHERE userId=?').bind(id),
    db
      .prepare(
        "UPDATE profile SET display_name='Deleted account',bio='',handle=? WHERE user_id=?",
      )
      .bind(
        'deleted_' + crypto.randomUUID().replaceAll('-', '').slice(0, 22),
        id,
      ),
    db
      .prepare(
        "UPDATE user SET name='Deleted account',email=?,emailVerified=0,image=NULL,updatedAt=? WHERE id=?",
      )
      .bind(`deleted-${id}@slowmass.invalid`, now, id),
  ]);
}
// Content becomes inaccessible through membership immediately. Physical erasure is bounded and retryable.
export async function cleanupAccounts(db: D1Database) {
  const pending = await db
    .prepare(
      'SELECT user_id FROM account_deletion WHERE completed_at IS NULL ORDER BY requested_at LIMIT 1',
    )
    .all<{ user_id: string }>();
  for (const { user_id: id } of pending.results) {
    const posts = await db
      .prepare(
        "SELECT id,object_key FROM post WHERE user_id=? AND state!='deleted' LIMIT 5",
      )
      .bind(id)
      .all<{ id: string; object_key: string | null }>();
    const statements: D1PreparedStatement[] = [];
    for (const post of posts.results) {
      if (post.object_key)
        statements.push(
          db
            .prepare(
              'INSERT INTO photo_cleanup(object_key,not_before) VALUES(?,?) ON CONFLICT DO NOTHING',
            )
            .bind(post.object_key, Date.now()),
        );
      statements.push(
        db
          .prepare(
            "UPDATE post SET state='deleted',caption='',alt_text='',object_key=NULL WHERE id=?",
          )
          .bind(post.id),
      );
    }
    statements.push(
      db
        .prepare(
          'INSERT INTO photo_cleanup(object_key,not_before) SELECT object_key,? FROM avatar WHERE user_id=? ON CONFLICT DO NOTHING',
        )
        .bind(Date.now(), id),
      db.prepare('DELETE FROM avatar WHERE user_id=?').bind(id),
      db
        .prepare(
          "UPDATE comment SET body='',deleted_at=? WHERE id IN(SELECT id FROM comment WHERE user_id=? AND deleted_at IS NULL LIMIT 100)",
        )
        .bind(Date.now(), id),
      db
        .prepare(
          'DELETE FROM post_like WHERE rowid IN(SELECT rowid FROM post_like WHERE user_id=? LIMIT 100)',
        )
        .bind(id),
      db
        .prepare(
          'DELETE FROM follow WHERE rowid IN(SELECT rowid FROM follow WHERE follower_id=? OR target_id=? LIMIT 100)',
        )
        .bind(id, id),
      db
        .prepare(
          'DELETE FROM block WHERE rowid IN(SELECT rowid FROM block WHERE blocker_id=? OR target_id=? LIMIT 100)',
        )
        .bind(id, id),
      db
        .prepare(
          'DELETE FROM notification_read WHERE rowid IN(SELECT rowid FROM notification_read WHERE user_id=? LIMIT 100)',
        )
        .bind(id),
      db
        .prepare(
          "UPDATE invitation SET recipient_email='deleted:'||?,revoked_at=COALESCE(revoked_at,?) WHERE id IN(SELECT i.id FROM invitation i JOIN account_deletion d ON d.email_to_redact=i.recipient_email WHERE d.user_id=? LIMIT 100)",
        )
        .bind(id, Date.now(), id),
      db
        .prepare(
          `UPDATE account_deletion SET completed_at=?,email_to_redact=NULL WHERE user_id=?
  AND NOT EXISTS(SELECT 1 FROM post WHERE user_id=? AND state!='deleted')
  AND NOT EXISTS(SELECT 1 FROM comment WHERE user_id=? AND deleted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM post_like WHERE user_id=?)
  AND NOT EXISTS(SELECT 1 FROM follow WHERE follower_id=? OR target_id=?)
  AND NOT EXISTS(SELECT 1 FROM block WHERE blocker_id=? OR target_id=?)
  AND NOT EXISTS(SELECT 1 FROM notification_read WHERE user_id=?)
  AND NOT EXISTS(SELECT 1 FROM invitation WHERE recipient_email=account_deletion.email_to_redact)`,
        )
        .bind(Date.now(), id, id, id, id, id, id, id, id, id),
    );
    await db.batch(statements);
  }
}

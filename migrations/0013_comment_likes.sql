CREATE TABLE comment_like (
  comment_id TEXT NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX comment_like_user ON comment_like(user_id);

CREATE TABLE post_like (
  post_id TEXT NOT NULL REFERENCES post(id),
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(post_id,user_id)
);
CREATE INDEX post_like_user ON post_like(user_id,created_at);
CREATE TABLE comment (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES post(id),
  user_id TEXT NOT NULL REFERENCES profile(user_id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK(deleted_at IS NOT NULL OR length(body) BETWEEN 1 AND 1000)
);
CREATE INDEX comment_post_page ON comment(post_id,created_at,id);
CREATE INDEX comment_user_time ON comment(user_id,created_at);
CREATE TABLE notification_read (
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  read_through INTEGER NOT NULL,
  PRIMARY KEY(user_id,event_key)
);

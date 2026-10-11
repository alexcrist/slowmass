CREATE TABLE avatar (
  user_id TEXT PRIMARY KEY REFERENCES profile(user_id),
  object_key TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);
CREATE TABLE photo_attempt (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','done','failed'))
);
CREATE INDEX photo_attempt_time ON photo_attempt(created_at);
CREATE INDEX photo_attempt_user_time ON photo_attempt(user_id,created_at);
CREATE TABLE photo_cleanup (
  object_key TEXT PRIMARY KEY,
  not_before INTEGER NOT NULL
);
CREATE INDEX photo_cleanup_due ON photo_cleanup(not_before);

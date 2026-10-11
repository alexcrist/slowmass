CREATE TABLE profile (
  user_id TEXT PRIMARY KEY REFERENCES membership(user_id),
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(handle) BETWEEN 3 AND 30 AND handle NOT GLOB '*[^a-z0-9_]*'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  created_at INTEGER NOT NULL
);
CREATE TABLE follow (
  follower_id TEXT NOT NULL REFERENCES profile(user_id),
  target_id TEXT NOT NULL REFERENCES profile(user_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_id),
  CHECK (follower_id != target_id)
);
CREATE INDEX follow_incoming ON follow(target_id, status, follower_id);
CREATE TABLE block (
  blocker_id TEXT NOT NULL REFERENCES profile(user_id),
  target_id TEXT NOT NULL REFERENCES profile(user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, target_id),
  CHECK (blocker_id != target_id)
);
CREATE INDEX block_incoming ON block(target_id, blocker_id);

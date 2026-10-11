CREATE TABLE post (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profile(user_id),
  caption TEXT NOT NULL CHECK(length(caption)<=2000),
  alt_text TEXT NOT NULL CHECK(length(alt_text)<=500),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','published','failed','deleted')),
  object_key TEXT UNIQUE,
  width INTEGER,
  height INTEGER,
  CHECK(state!='published' OR (object_key IS NOT NULL AND published_at IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND width>0 AND height>0))
);
CREATE INDEX post_author_feed ON post(user_id,state,published_at DESC,id DESC);
CREATE INDEX post_publication_clock ON post(published_at DESC);
CREATE INDEX post_stale_upload ON post(state,created_at);

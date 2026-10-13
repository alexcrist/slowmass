-- Nullable for existing posts; new uploads publish both variants atomically.
ALTER TABLE post ADD COLUMN thumbnail_key TEXT;
CREATE UNIQUE INDEX post_thumbnail_object ON post(thumbnail_key);
CREATE INDEX post_missing_thumbnail ON post(published_at, id)
  WHERE state='published' AND thumbnail_key IS NULL;

-- Keep the shared transformation budget accurate when posts produce two sizes.
ALTER TABLE photo_attempt ADD COLUMN processing_units INTEGER NOT NULL DEFAULT 1
  CHECK(processing_units BETWEEN 1 AND 2);
UPDATE photo_attempt SET processing_units=2 WHERE state='pending' AND id LIKE '%:post/%';

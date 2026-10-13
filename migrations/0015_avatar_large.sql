-- Existing avatars keep their small image; only future uploads create both sizes.
ALTER TABLE avatar ADD COLUMN large_key TEXT;
CREATE UNIQUE INDEX avatar_large_object ON avatar(large_key);

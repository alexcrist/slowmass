-- Keep the original constrained column intact for the previous Worker.
-- NULL means read its value through the current catalog's replacement map.
-- No event rows or dependent records are rewritten during deployment.
ALTER TABLE event ADD COLUMN font_pairing_v2 TEXT
  CHECK (font_pairing_v2 IN ('original','handwritten','classic','bungee-shade','monoton','fascinate-inline','rubik-wet-paint'));

-- If a rollback Worker edits appearance, its selection takes precedence.
-- The current Worker writes only v2, so its saves never fire this trigger.
CREATE TRIGGER event_legacy_font_update AFTER UPDATE OF font_pairing ON event
WHEN NEW.font_pairing_v2 IS NOT NULL
BEGIN
  UPDATE event SET font_pairing_v2=NULL WHERE id=NEW.id;
END;

-- Additive defaults preserve existing events and the previous Worker's
-- explicit-column inserts and detail updates. No media or provenance changes.
ALTER TABLE event ADD COLUMN color_theme TEXT NOT NULL DEFAULT 'original'
  CHECK (color_theme IN ('original','pool','lilac','citrus','cherry','after-hours','wine','evergreen','candlelight'));
ALTER TABLE event ADD COLUMN font_pairing TEXT NOT NULL DEFAULT 'original'
  CHECK (font_pairing IN ('original','handwritten','classic','poster','rounded','geometric'));

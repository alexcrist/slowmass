-- Existing attribution, credentials, dates and redemption counts are retained.
-- All links now have the same capacity; private labels are permanently removed.
DROP TRIGGER invite_link_immutable;
UPDATE invite_link SET max_uses=100 WHERE max_uses!=100;
ALTER TABLE invite_link DROP COLUMN name;
CREATE TRIGGER invite_link_immutable BEFORE UPDATE OF id,inviter_id,token_hash,created_at,max_uses,expires_at ON invite_link BEGIN
  SELECT RAISE(ABORT,'immutable_invite_link');
END;
CREATE TRIGGER invite_link_fixed_capacity BEFORE INSERT ON invite_link
WHEN NEW.max_uses!=100 BEGIN
  SELECT RAISE(ABORT,'invite_link_capacity_must_be_100');
END;

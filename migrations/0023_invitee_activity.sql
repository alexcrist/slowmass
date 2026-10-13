-- Expand activity kinds atomically, preserving receipts, versions and queued push.
-- No historical join events are backfilled.
DROP TRIGGER activity_avatar_complete;
CREATE TABLE joined_receipt_backup AS SELECT * FROM activity_read_state;
CREATE TABLE joined_push_backup AS SELECT * FROM push_delivery;
DROP TRIGGER push_activity_insert;
DROP TRIGGER activity_follow_insert;
DROP TRIGGER activity_follow_update;
DROP TRIGGER activity_follow_delete;
DROP TRIGGER activity_post_like_insert;
DROP TRIGGER activity_post_like_update;
DROP TRIGGER activity_post_like_delete;
DROP TRIGGER activity_comment_insert;
DROP TRIGGER activity_comment_update;
DROP TRIGGER activity_comment_delete;
CREATE TABLE activity_source_next (
  recipient_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES membership(user_id),
  kind TEXT NOT NULL CHECK(kind IN ('request','follower','joined','likes','comment')),
  post_id TEXT REFERENCES post(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id,event_key,actor_id)
);
INSERT INTO activity_source_next SELECT * FROM activity_source;
-- Cascades temporarily remove receipts/deliveries; restore their exact versions
-- below. Keeping the receipt table preserves its AUTOINCREMENT high-water mark.
DROP TABLE activity_source;
ALTER TABLE activity_source_next RENAME TO activity_source;
CREATE INDEX activity_page ON activity_source(recipient_id,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_kind_page ON activity_source(recipient_id,kind,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_group_page ON activity_source(recipient_id,event_key,created_at DESC,actor_id DESC);
CREATE INDEX activity_post ON activity_source(post_id);

INSERT INTO activity_read_state SELECT * FROM joined_receipt_backup;
INSERT INTO push_delivery SELECT * FROM joined_push_backup;
DROP TABLE joined_push_backup;
DROP TABLE joined_receipt_backup;

CREATE TRIGGER activity_receipt_insert AFTER INSERT ON activity_source BEGIN
  INSERT INTO activity_read_state(recipient_id,event_key,actor_id)
  VALUES(NEW.recipient_id,NEW.event_key,NEW.actor_id);
END;
CREATE TRIGGER activity_receipt_update BEFORE UPDATE ON activity_source BEGIN
  DELETE FROM activity_read_state WHERE recipient_id=OLD.recipient_id
    AND event_key=OLD.event_key AND actor_id=OLD.actor_id;
END;
CREATE TRIGGER activity_receipt_updated AFTER UPDATE ON activity_source BEGIN
  INSERT INTO activity_read_state(recipient_id,event_key,actor_id)
  VALUES(NEW.recipient_id,NEW.event_key,NEW.actor_id);
END;
CREATE TRIGGER push_activity_insert AFTER INSERT ON activity_read_state BEGIN
  INSERT INTO push_delivery(subscription_id,event_key,version,created_at,available_at)
  SELECT s.id,NEW.event_key,NEW.revision,unixepoch()*1000,
    unixepoch()*1000+CASE WHEN e.kind='likes' THEN 10000 ELSE 0 END
  FROM push_subscription s JOIN session a ON a.id=s.session_id
    JOIN activity_source e ON e.recipient_id=NEW.recipient_id AND e.event_key=NEW.event_key AND e.actor_id=NEW.actor_id
  WHERE s.user_id=NEW.recipient_id AND NEW.is_read=0 AND a.expiresAt>unixepoch()*1000
  ON CONFLICT(subscription_id,event_key) DO UPDATE SET
    version=excluded.version,created_at=excluded.created_at,available_at=excluded.available_at,
    attempts=0,lease=NULL,lease_until=0;
END;

-- A pending request becomes a new-follower event only after acceptance. Repeated
-- accepts do not replace a source or reset its read version.
CREATE TRIGGER activity_follow_insert AFTER INSERT ON follow BEGIN
  INSERT INTO activity_source SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
  INSERT INTO activity_source
  SELECT NEW.target_id,'follower:'||NEW.follower_id,NEW.follower_id,'follower',NULL,unixepoch()*1000
  WHERE NEW.status='accepted'
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.follower_id)
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.target_id);
END;
CREATE TRIGGER activity_follow_update AFTER UPDATE ON follow
WHEN OLD.status!=NEW.status OR OLD.follower_id!=NEW.follower_id OR OLD.target_id!=NEW.target_id
  OR (NEW.status='pending' AND OLD.created_at!=NEW.created_at) BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND actor_id=OLD.follower_id
    AND event_key IN ('request:'||OLD.follower_id,'follower:'||OLD.follower_id);
  INSERT INTO activity_source SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
  INSERT INTO activity_source
  SELECT NEW.target_id,'follower:'||NEW.follower_id,NEW.follower_id,'follower',NULL,unixepoch()*1000
  WHERE NEW.status='accepted'
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.follower_id)
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.target_id);
END;
CREATE TRIGGER activity_follow_delete AFTER DELETE ON follow BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND actor_id=OLD.follower_id
    AND event_key IN ('request:'||OLD.follower_id,'follower:'||OLD.follower_id);
END;

-- Invitation follows exist before photo setup. Notify both people only once both
-- required photos exist. Avatar replacement updates the row and does not replay.
CREATE TRIGGER activity_avatar_complete AFTER INSERT ON avatar BEGIN
  INSERT INTO activity_source
  SELECT f.target_id,'follower:'||f.follower_id,f.follower_id,'follower',NULL,unixepoch()*1000
  FROM follow f JOIN avatar a ON a.user_id=f.follower_id JOIN avatar t ON t.user_id=f.target_id
  JOIN membership am ON am.user_id=f.follower_id AND am.status='active'
  JOIN membership tm ON tm.user_id=f.target_id AND tm.status='active'
  WHERE (f.follower_id=NEW.user_id OR f.target_id=NEW.user_id) AND f.status='accepted'
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=f.follower_id AND target_id=f.target_id) OR (blocker_id=f.target_id AND target_id=f.follower_id))
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER activity_post_like_insert AFTER INSERT ON post_like BEGIN
  INSERT INTO activity_source SELECT p.user_id,'likes:'||NEW.post_id,NEW.user_id,'likes',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id;
END;
CREATE TRIGGER activity_post_like_update AFTER UPDATE ON post_like BEGIN
  DELETE FROM activity_source WHERE event_key='likes:'||OLD.post_id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
  INSERT INTO activity_source SELECT p.user_id,'likes:'||NEW.post_id,NEW.user_id,'likes',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id;
END;
CREATE TRIGGER activity_post_like_delete AFTER DELETE ON post_like BEGIN
  DELETE FROM activity_source WHERE event_key='likes:'||OLD.post_id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
END;

CREATE TRIGGER activity_comment_insert AFTER INSERT ON comment BEGIN
  INSERT INTO activity_source SELECT p.user_id,'comment:'||NEW.id,NEW.user_id,'comment',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER activity_comment_update AFTER UPDATE ON comment BEGIN
  DELETE FROM activity_source WHERE event_key='comment:'||OLD.id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
  INSERT INTO activity_source SELECT p.user_id,'comment:'||NEW.id,NEW.user_id,'comment',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER activity_comment_delete AFTER DELETE ON comment BEGIN
  DELETE FROM activity_source WHERE event_key='comment:'||OLD.id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
END;

ALTER TABLE membership ADD COLUMN join_activity_pending INTEGER NOT NULL DEFAULT 0 CHECK(join_activity_pending IN (0,1));
CREATE TRIGGER membership_join_activity AFTER INSERT ON membership
WHEN NEW.invited_by IS NOT NULL BEGIN
  UPDATE membership SET join_activity_pending=1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER avatar_join_activity AFTER INSERT ON avatar BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT m.invited_by,'joined:'||m.user_id,m.user_id,'joined',NULL,unixepoch()*1000
  FROM membership m JOIN membership parent ON parent.user_id=m.invited_by
  JOIN profile p ON p.user_id=m.user_id
  WHERE m.user_id=NEW.user_id AND m.join_activity_pending=1
    AND m.status='active' AND parent.status='active'
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=m.user_id AND target_id=m.invited_by) OR (blocker_id=m.invited_by AND target_id=m.user_id))
  ON CONFLICT DO NOTHING;
  UPDATE membership SET join_activity_pending=0 WHERE user_id=NEW.user_id;
END;

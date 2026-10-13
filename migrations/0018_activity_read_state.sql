-- One receipt per live interaction source. Versions never repeat, even when a
-- request is cancelled and sent again or two likes share a millisecond.
CREATE TABLE activity_read_state (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
  UNIQUE(recipient_id,event_key,actor_id),
  FOREIGN KEY(recipient_id,event_key,actor_id)
    REFERENCES activity_source(recipient_id,event_key,actor_id) ON DELETE CASCADE
);
CREATE INDEX activity_unread ON activity_read_state(recipient_id,event_key) WHERE is_read=0;
CREATE INDEX activity_receipt_group ON activity_read_state(recipient_id,event_key,revision);

INSERT INTO activity_read_state(recipient_id,event_key,actor_id,is_read)
SELECT e.recipient_id,e.event_key,e.actor_id,
  EXISTS(SELECT 1 FROM notification_read r WHERE r.user_id=e.recipient_id
    AND r.event_key=e.event_key AND r.read_through>=e.created_at)
FROM activity_source e;

-- Existing application versions also produce receipts in the same transaction.
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

CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  session_id TEXT NOT NULL UNIQUE REFERENCES session(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_member ON push_subscription(user_id);

-- A bounded dispatcher retries committed work independently of the HTTP request.
-- One pending delivery per subscription/logical notification coalesces like updates.
CREATE TABLE push_delivery (
  subscription_id TEXT NOT NULL REFERENCES push_subscription(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  version INTEGER NOT NULL REFERENCES activity_read_state(revision) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(subscription_id,event_key)
);
CREATE INDEX push_due ON push_delivery(available_at,lease_until);
CREATE INDEX push_source ON push_delivery(version);
CREATE INDEX push_age ON push_delivery(created_at);
CREATE INDEX push_exhausted ON push_delivery(lease_until) WHERE attempts>=8;

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
CREATE TRIGGER push_activity_read AFTER UPDATE OF is_read ON activity_read_state WHEN NEW.is_read=1 BEGIN
  DELETE FROM push_delivery WHERE version=NEW.revision;
END;
CREATE TRIGGER push_member_inactive AFTER UPDATE OF status ON membership WHEN NEW.status!='active' BEGIN
  DELETE FROM push_subscription WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER push_subscription_replace BEFORE UPDATE ON push_subscription
WHEN OLD.endpoint!=NEW.endpoint OR OLD.p256dh!=NEW.p256dh OR OLD.auth!=NEW.auth BEGIN
  DELETE FROM push_delivery WHERE subscription_id=OLD.id;
END;

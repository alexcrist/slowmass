-- Per-category push and email preferences, email notification delivery, and
-- update blasts. Additive: the previous Worker never writes a blast or a
-- preference, so its push behavior and absence of email are unchanged.

-- An update blast is a host message that also emails its recipients.
ALTER TABLE event_message ADD COLUMN blast INTEGER NOT NULL DEFAULT 0 CHECK(blast IN (0,1));
CREATE INDEX event_message_blasts ON event_message(event_id,created_at) WHERE blast=1;

-- Categories name Activity kinds, except that event messages split into
-- ordinary messages, update blasts and cancellations. A member's missing
-- preference row means these defaults, which match earlier behavior.
CREATE TABLE notification_category (
  id TEXT PRIMARY KEY,
  push INTEGER NOT NULL CHECK(push IN (0,1)),
  email INTEGER NOT NULL CHECK(email IN (0,1))
);
INSERT INTO notification_category(id,push,email) VALUES
  ('request',1,0),
  ('follower',1,0),
  ('joined',1,0),
  ('likes',0,0),
  ('comment',1,0),
  ('event_response',1,0),
  ('event_message',1,0),
  ('update_blast',1,1),
  ('event_cancelled',1,0);
CREATE TABLE notification_preference (
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  category TEXT NOT NULL REFERENCES notification_category(id),
  push INTEGER NOT NULL CHECK(push IN (0,1)),
  email INTEGER NOT NULL CHECK(email IN (0,1)),
  PRIMARY KEY(user_id,category)
);

-- One pending email per member and logical notification coalesces a like
-- group. A NULL version is a host's copy of their own update blast, which has
-- no Activity source; every other row disappears with its source.
CREATE TABLE email_delivery (
  recipient_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  version INTEGER REFERENCES activity_read_state(revision) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(recipient_id,event_key)
);
CREATE INDEX email_due ON email_delivery(available_at);
CREATE INDEX email_age ON email_delivery(created_at);
CREATE INDEX email_source ON email_delivery(version);

-- Like alerts wait 15 minutes so a burst becomes one alert; a newer like in
-- the group updates the pending alert without postponing it. Other email
-- waits 10 minutes, so activity already read in the app is not also emailed;
-- update blasts and cancellations go out at once.
DROP TRIGGER push_activity_insert;
CREATE TRIGGER push_activity_insert AFTER INSERT ON activity_read_state BEGIN
  INSERT INTO push_delivery(subscription_id,event_key,version,created_at,available_at)
  SELECT s.id,NEW.event_key,NEW.revision,unixepoch()*1000,
    unixepoch()*1000+CASE WHEN e.kind='likes' THEN 900000 ELSE 0 END
  FROM push_subscription s JOIN session a ON a.id=s.session_id
    JOIN activity_source e ON e.recipient_id=NEW.recipient_id AND e.event_key=NEW.event_key AND e.actor_id=NEW.actor_id
    JOIN notification_category c ON c.id=CASE WHEN e.kind='event_message' THEN COALESCE(
      (SELECT CASE WHEN m.kind='cancelled' THEN 'event_cancelled' WHEN m.blast=1 THEN 'update_blast' ELSE 'event_message' END
        FROM event_message m WHERE m.id=substr(e.event_key,15)),'event_message') ELSE e.kind END
    LEFT JOIN notification_preference p ON p.user_id=NEW.recipient_id AND p.category=c.id
  WHERE s.user_id=NEW.recipient_id AND NEW.is_read=0
    AND a.expiresAt>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND COALESCE(p.push,c.push)=1
  ON CONFLICT(subscription_id,event_key) DO UPDATE SET
    version=excluded.version,created_at=excluded.created_at,
    available_at=MIN(push_delivery.available_at,excluded.available_at),
    attempts=0,lease=NULL,lease_until=0;
END;
CREATE TRIGGER email_activity_insert AFTER INSERT ON activity_read_state BEGIN
  INSERT INTO email_delivery(recipient_id,event_key,version,created_at,available_at)
  SELECT NEW.recipient_id,NEW.event_key,NEW.revision,unixepoch()*1000,
    unixepoch()*1000+CASE c.id WHEN 'update_blast' THEN 0 WHEN 'event_cancelled' THEN 0
      WHEN 'likes' THEN 900000 ELSE 600000 END
  FROM activity_source e
    JOIN notification_category c ON c.id=CASE WHEN e.kind='event_message' THEN COALESCE(
      (SELECT CASE WHEN m.kind='cancelled' THEN 'event_cancelled' WHEN m.blast=1 THEN 'update_blast' ELSE 'event_message' END
        FROM event_message m WHERE m.id=substr(e.event_key,15)),'event_message') ELSE e.kind END
    LEFT JOIN notification_preference p ON p.user_id=NEW.recipient_id AND p.category=c.id
  WHERE e.recipient_id=NEW.recipient_id AND e.event_key=NEW.event_key AND e.actor_id=NEW.actor_id
    AND NEW.is_read=0 AND COALESCE(p.email,c.email)=1
  ON CONFLICT(recipient_id,event_key) DO UPDATE SET
    version=excluded.version,created_at=excluded.created_at,
    available_at=MIN(email_delivery.available_at,excluded.available_at),
    attempts=0,lease=NULL,lease_until=0;
END;
-- The host who sends an update blast gets a copy of its email too.
CREATE TRIGGER email_blast_copy AFTER INSERT ON event_message WHEN NEW.blast=1 BEGIN
  INSERT INTO email_delivery(recipient_id,event_key,version,created_at,available_at)
  SELECT NEW.user_id,'event_message:'||NEW.id,NULL,NEW.created_at,NEW.created_at
  FROM notification_category c
    LEFT JOIN notification_preference p ON p.user_id=NEW.user_id AND p.category=c.id
  WHERE c.id='update_blast' AND COALESCE(p.email,c.email)=1
  ON CONFLICT DO NOTHING;
END;

-- Accepting a request records the new follower in the accepter's Activity
-- (with Follow back) but as already read: they just acted on it, so it neither
-- raises their badge nor alerts them. Marking it read cancels queued push.
DROP TRIGGER activity_follow_update;
CREATE TRIGGER activity_follow_update AFTER UPDATE ON follow
WHEN OLD.status!=NEW.status OR OLD.follower_id!=NEW.follower_id OR OLD.target_id!=NEW.target_id
  OR (NEW.status='pending' AND OLD.created_at!=NEW.created_at) BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND actor_id=OLD.follower_id
    AND event_key IN ('request:'||OLD.follower_id,'follower:'||OLD.follower_id);
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.target_id,'follower:'||NEW.follower_id,NEW.follower_id,'follower',NULL,unixepoch()*1000
  WHERE NEW.status='accepted'
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.follower_id)
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.target_id);
  UPDATE activity_read_state SET is_read=1
  WHERE recipient_id=NEW.target_id AND event_key='follower:'||NEW.follower_id
    AND actor_id=NEW.follower_id AND OLD.status='pending' AND NEW.status='accepted'
    AND OLD.follower_id=NEW.follower_id AND OLD.target_id=NEW.target_id;
END;

-- The last alert per member, notification and channel. A different version of
-- the same notification (a re-sent request, a changed RSVP, a growing like
-- group) alerts again only after an hour, so toggling cannot spam anyone.
CREATE TABLE notification_alert (
  recipient_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('push','email')),
  version INTEGER,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id,event_key,channel)
);
CREATE INDEX notification_alert_age ON notification_alert(sent_at);

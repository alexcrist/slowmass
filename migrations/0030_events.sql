-- Events: one cover photo, details, hosts, responses and a message log. An
-- event's link is the only way to invite people. Its revocable credential
-- (hash plus recoverable ciphertext) lets a signed-in member open the event;
-- responding grants access that survives link replacement. An event is over
-- twelve hours after it starts unless it has an end time.
CREATE TABLE event (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES membership(user_id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
  location TEXT NOT NULL DEFAULT '' CHECK(length(location)<=300),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER CHECK(ends_at IS NULL OR ends_at>starts_at),
  time_zone TEXT NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 64),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published','deleted')),
  object_key TEXT,
  thumbnail_key TEXT,
  width INTEGER,
  height INTEGER,
  link_id TEXT NOT NULL UNIQUE,
  link_hash TEXT NOT NULL UNIQUE,
  link_encrypted TEXT,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  CHECK(state!='published' OR (object_key IS NOT NULL AND thumbnail_key IS NOT NULL))
);
CREATE INDEX event_creator_created ON event(creator_id,created_at);
CREATE INDEX event_pending ON event(created_at) WHERE state='pending';
CREATE TRIGGER event_creator_immutable BEFORE UPDATE OF creator_id ON event BEGIN
  SELECT RAISE(ABORT,'immutable_event_creator');
END;
CREATE TABLE event_host (
  event_id TEXT NOT NULL REFERENCES event(id),
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX event_host_member ON event_host(user_id);
CREATE TABLE event_response (
  event_id TEXT NOT NULL REFERENCES event(id),
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  status TEXT NOT NULL CHECK(status IN ('going','maybe','declined')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX event_response_member ON event_response(user_id);
CREATE INDEX event_response_status ON event_response(event_id,status,updated_at DESC,user_id DESC);
CREATE INDEX event_response_recent ON event_response(event_id,updated_at DESC,user_id DESC);
-- 'changed' bodies list the changed details ('time', 'location' or both).
CREATE TABLE event_message (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id),
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  kind TEXT NOT NULL CHECK(kind IN ('message','changed','cancelled')),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=2000),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX event_message_recent ON event_message(event_id,created_at DESC,id DESC);
CREATE INDEX event_message_member ON event_message(user_id);
-- Which link version let a member open an event. Opening grants access only
-- while that version is current; it also traces joins back to a link.
CREATE TABLE event_access (
  event_id TEXT NOT NULL REFERENCES event(id),
  user_id TEXT NOT NULL REFERENCES membership(user_id),
  link_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX event_access_member ON event_access(user_id);
CREATE INDEX event_access_link ON event_access(link_id);
-- Signing in through an event link. Like invite-link claims, a claim pins the
-- exact link version until expiry so verification cannot switch it.
CREATE TABLE event_claim (
  token_hash TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL REFERENCES event(id),
  inviter_id TEXT NOT NULL REFERENCES membership(user_id),
  link_id TEXT NOT NULL,
  link_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX event_claim_expiry ON event_claim(expires_at);
CREATE INDEX event_claim_email ON event_claim(email);

-- People joining through an event link hold a shared invitation from the event
-- creator that records the event and the exact link version they used.
ALTER TABLE invitation ADD COLUMN event_id TEXT REFERENCES event(id);
ALTER TABLE invitation ADD COLUMN event_link_id TEXT;
CREATE INDEX invitation_event_link ON invitation(event_link_id) WHERE event_link_id IS NOT NULL;
CREATE TRIGGER invitation_event_immutable BEFORE UPDATE OF event_id,event_link_id ON invitation BEGIN
  SELECT RAISE(ABORT,'immutable_invitation_event');
END;
-- Event links replace email invitations and invite links. Every invitation and
-- join stays for provenance; outstanding credentials stop working.
UPDATE invitation SET revoked_at=unixepoch()*1000,email_payload=NULL
WHERE accepted_by IS NULL AND revoked_at IS NULL;
UPDATE invite_link SET token_encrypted=NULL,revoked_at=COALESCE(revoked_at,unixepoch()*1000);
DELETE FROM invite_link_claim;
DROP TRIGGER membership_validate_link;
CREATE TRIGGER membership_validate_link BEFORE INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM invitation i WHERE i.id=NEW.invitation_id AND i.kind='shared'
      AND NOT EXISTS (
        SELECT 1 FROM invite_link_claim c JOIN invite_link l ON l.inviter_id=c.inviter_id
          AND l.id=c.invite_link_id AND l.token_hash=c.invite_link_token_hash
        JOIN membership parent ON parent.user_id=l.inviter_id AND parent.status='active'
        JOIN avatar a ON a.user_id=l.inviter_id
        WHERE i.event_id IS NULL AND c.invitation_id=i.id AND c.inviter_id=NEW.invited_by
          AND c.email=i.recipient_email AND c.expires_at>NEW.joined_at
          AND l.expires_at>NEW.joined_at AND l.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_claim c JOIN event e ON e.id=c.event_id
          AND e.link_id=c.link_id AND e.link_hash=c.link_hash
        JOIN membership parent ON parent.user_id=e.creator_id AND parent.status='active'
        JOIN avatar a ON a.user_id=e.creator_id
        WHERE i.event_id=c.event_id AND i.event_link_id=c.link_id
          AND c.invitation_id=i.id AND c.inviter_id=NEW.invited_by
          AND c.inviter_id=e.creator_id AND c.email=i.recipient_email
          AND c.expires_at>NEW.joined_at AND e.state='published' AND e.cancelled_at IS NULL
          AND COALESCE(e.ends_at,e.starts_at+43200000)>NEW.joined_at
      )
  ) THEN RAISE(ABORT,'invite_link_unavailable') END;
END;

-- Expand activity kinds atomically, preserving receipts, versions and queued
-- push (the 0023 procedure). Every trigger that names the table is recreated,
-- now with explicit column lists. Event activity keys identify their source:
-- 'event_response:<event>.<member>' and 'event_message:<message>'.
DROP TRIGGER push_activity_insert;
DROP TRIGGER activity_avatar_complete;
DROP TRIGGER avatar_join_activity;
DROP TRIGGER activity_follow_insert;
DROP TRIGGER activity_follow_update;
DROP TRIGGER activity_follow_delete;
DROP TRIGGER activity_post_like_insert;
DROP TRIGGER activity_post_like_update;
DROP TRIGGER activity_post_like_move;
DROP TRIGGER activity_post_like_delete;
DROP TRIGGER activity_comment_insert;
DROP TRIGGER activity_comment_update;
DROP TRIGGER activity_comment_delete;
CREATE TABLE event_receipt_backup AS SELECT * FROM activity_read_state;
CREATE TABLE event_push_backup AS SELECT * FROM push_delivery;
CREATE TABLE activity_source_next (
  recipient_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES membership(user_id),
  kind TEXT NOT NULL CHECK(kind IN ('request','follower','joined','likes','comment','event_response','event_message')),
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

INSERT INTO activity_read_state SELECT * FROM event_receipt_backup;
INSERT INTO push_delivery SELECT * FROM event_push_backup;
DROP TABLE event_push_backup;
DROP TABLE event_receipt_backup;

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
-- Better Auth stores session expiry as ISO-8601 text; compare in that format.
CREATE TRIGGER push_activity_insert AFTER INSERT ON activity_read_state BEGIN
  INSERT INTO push_delivery(subscription_id,event_key,version,created_at,available_at)
  SELECT s.id,NEW.event_key,NEW.revision,unixepoch()*1000,unixepoch()*1000
  FROM push_subscription s JOIN session a ON a.id=s.session_id
    JOIN activity_source e ON e.recipient_id=NEW.recipient_id AND e.event_key=NEW.event_key AND e.actor_id=NEW.actor_id
  WHERE s.user_id=NEW.recipient_id AND NEW.is_read=0
    AND a.expiresAt>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND e.kind!='likes'
  ON CONFLICT(subscription_id,event_key) DO UPDATE SET
    version=excluded.version,created_at=excluded.created_at,available_at=excluded.available_at,
    attempts=0,lease=NULL,lease_until=0;
END;

CREATE TRIGGER activity_follow_insert AFTER INSERT ON follow BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
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
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.target_id,'follower:'||NEW.follower_id,NEW.follower_id,'follower',NULL,unixepoch()*1000
  WHERE NEW.status='accepted'
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.follower_id)
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=NEW.target_id);
END;
CREATE TRIGGER activity_follow_delete AFTER DELETE ON follow BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND actor_id=OLD.follower_id
    AND event_key IN ('request:'||OLD.follower_id,'follower:'||OLD.follower_id);
END;

CREATE TRIGGER activity_avatar_complete AFTER INSERT ON avatar BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT f.target_id,'follower:'||f.follower_id,f.follower_id,'follower',NULL,unixepoch()*1000
  FROM follow f JOIN avatar a ON a.user_id=f.follower_id JOIN avatar t ON t.user_id=f.target_id
  JOIN membership am ON am.user_id=f.follower_id AND am.status='active'
  JOIN membership tm ON tm.user_id=f.target_id AND tm.status='active'
  WHERE (f.follower_id=NEW.user_id OR f.target_id=NEW.user_id) AND f.status='accepted'
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=f.follower_id AND target_id=f.target_id) OR (blocker_id=f.target_id AND target_id=f.follower_id))
  ON CONFLICT DO NOTHING;
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

CREATE TRIGGER activity_post_like_insert AFTER INSERT ON post_like BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT p.user_id,
    COALESCE(
      (SELECT CASE WHEN t.kind='likes' AND t.post_id=NEW.post_id THEN t.event_key END
        FROM activity_source t WHERE t.recipient_id=p.user_id
        ORDER BY t.created_at DESC,t.event_key DESC,t.actor_id DESC LIMIT 1),
      CASE WHEN EXISTS(SELECT 1 FROM activity_source o
          WHERE o.recipient_id=p.user_id AND o.event_key='likes:'||NEW.post_id)
        THEN 'likes:'||NEW.post_id||'-'||lower(hex(randomblob(6)))
        ELSE 'likes:'||NEW.post_id END),
    NEW.user_id,'likes',NEW.post_id,NEW.created_at
  FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id;
END;
CREATE TRIGGER activity_post_like_update AFTER UPDATE ON post_like
WHEN NEW.post_id=OLD.post_id AND NEW.user_id=OLD.user_id BEGIN
  UPDATE activity_source SET created_at=NEW.created_at
  WHERE recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id)
    AND event_key>='likes:'||OLD.post_id AND event_key<'likes:'||OLD.post_id||'.'
    AND actor_id=OLD.user_id;
END;
CREATE TRIGGER activity_post_like_move AFTER UPDATE ON post_like
WHEN NEW.post_id!=OLD.post_id OR NEW.user_id!=OLD.user_id BEGIN
  DELETE FROM activity_source
  WHERE recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id)
    AND event_key>='likes:'||OLD.post_id AND event_key<'likes:'||OLD.post_id||'.'
    AND actor_id=OLD.user_id;
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT p.user_id,
    COALESCE(
      (SELECT CASE WHEN t.kind='likes' AND t.post_id=NEW.post_id THEN t.event_key END
        FROM activity_source t WHERE t.recipient_id=p.user_id
        ORDER BY t.created_at DESC,t.event_key DESC,t.actor_id DESC LIMIT 1),
      CASE WHEN EXISTS(SELECT 1 FROM activity_source o
          WHERE o.recipient_id=p.user_id AND o.event_key='likes:'||NEW.post_id)
        THEN 'likes:'||NEW.post_id||'-'||lower(hex(randomblob(6)))
        ELSE 'likes:'||NEW.post_id END),
    NEW.user_id,'likes',NEW.post_id,NEW.created_at
  FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id;
END;
CREATE TRIGGER activity_post_like_delete AFTER DELETE ON post_like BEGIN
  DELETE FROM activity_source
  WHERE recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id)
    AND event_key>='likes:'||OLD.post_id AND event_key<'likes:'||OLD.post_id||'.'
    AND actor_id=OLD.user_id;
END;

CREATE TRIGGER activity_comment_insert AFTER INSERT ON comment BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT p.user_id,'comment:'||NEW.id,NEW.user_id,'comment',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER activity_comment_update AFTER UPDATE ON comment BEGIN
  DELETE FROM activity_source WHERE event_key='comment:'||OLD.id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT p.user_id,'comment:'||NEW.id,NEW.user_id,'comment',NEW.post_id,NEW.created_at FROM post p WHERE p.id=NEW.post_id AND p.user_id!=NEW.user_id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER activity_comment_delete AFTER DELETE ON comment BEGIN
  DELETE FROM activity_source WHERE event_key='comment:'||OLD.id AND actor_id=OLD.user_id AND recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id);
END;

-- Hosts hear each guest's current answer. Changing it is new activity; saving
-- the same answer again is not. Deletes seek each recipient's primary key.
CREATE TRIGGER activity_event_response_insert AFTER INSERT ON event_response BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT h.user_id,'event_response:'||NEW.event_id||'.'||NEW.user_id,NEW.user_id,'event_response',NULL,NEW.updated_at
  FROM event_host h WHERE h.event_id=NEW.event_id AND h.user_id!=NEW.user_id
  ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER activity_event_response_update AFTER UPDATE ON event_response
WHEN OLD.status!=NEW.status OR OLD.event_id!=NEW.event_id OR OLD.user_id!=NEW.user_id BEGIN
  DELETE FROM activity_source WHERE recipient_id IN (SELECT user_id FROM event_host WHERE event_id=OLD.event_id)
    AND event_key='event_response:'||OLD.event_id||'.'||OLD.user_id AND actor_id=OLD.user_id;
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT h.user_id,'event_response:'||NEW.event_id||'.'||NEW.user_id,NEW.user_id,'event_response',NULL,NEW.updated_at
  FROM event_host h WHERE h.event_id=NEW.event_id AND h.user_id!=NEW.user_id
  ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER activity_event_response_delete AFTER DELETE ON event_response BEGIN
  DELETE FROM activity_source WHERE recipient_id IN (SELECT user_id FROM event_host WHERE event_id=OLD.event_id)
    AND event_key='event_response:'||OLD.event_id||'.'||OLD.user_id AND actor_id=OLD.user_id;
END;
-- Every message reaches the other hosts. Host messages, detail changes and
-- cancellation also reach every guest who has answered.
CREATE TRIGGER activity_event_message_insert AFTER INSERT ON event_message
WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT h.user_id,'event_message:'||NEW.id,NEW.user_id,'event_message',NULL,NEW.created_at
  FROM event_host h WHERE h.event_id=NEW.event_id AND h.user_id!=NEW.user_id
  ON CONFLICT DO NOTHING;
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT r.user_id,'event_message:'||NEW.id,NEW.user_id,'event_message',NULL,NEW.created_at
  FROM event_response r WHERE r.event_id=NEW.event_id AND r.user_id!=NEW.user_id
    AND EXISTS(SELECT 1 FROM event_host WHERE event_id=NEW.event_id AND user_id=NEW.user_id)
  ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER activity_event_message_delete AFTER UPDATE OF deleted_at ON event_message
WHEN NEW.deleted_at IS NOT NULL BEGIN
  DELETE FROM activity_source WHERE recipient_id IN (
      SELECT user_id FROM event_host WHERE event_id=NEW.event_id
      UNION SELECT user_id FROM event_response WHERE event_id=NEW.event_id)
    AND event_key='event_message:'||NEW.id AND actor_id=NEW.user_id;
END;

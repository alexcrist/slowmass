-- New comment activity is additive; no historical notifications are backfilled.
-- New sources keep post_id NULL and resolve the photo through the comment key,
-- so the previous Worker's owner-photo fallback cannot expose unknown kinds.
INSERT INTO notification_category(id,push,email) VALUES('thread_comment',1,0),('comment_like',1,0);

DROP TRIGGER activity_post_publish;
DROP TRIGGER activity_follow_insert;
DROP TRIGGER activity_follow_delete;
DROP TRIGGER activity_avatar_complete;
DROP TRIGGER avatar_join_activity;
DROP TRIGGER activity_post_like_insert;
DROP TRIGGER activity_post_like_update;
DROP TRIGGER activity_post_like_move;
DROP TRIGGER activity_post_like_delete;
DROP TRIGGER activity_comment_insert;
DROP TRIGGER activity_comment_update;
DROP TRIGGER activity_comment_delete;
DROP TRIGGER activity_event_response_insert;
DROP TRIGGER activity_event_response_update;
DROP TRIGGER activity_event_response_delete;
DROP TRIGGER activity_event_message_insert;
DROP TRIGGER activity_event_message_delete;
DROP TRIGGER push_activity_insert;
DROP TRIGGER email_activity_insert;
DROP TRIGGER activity_follow_update;
DROP TRIGGER activity_host_invite_insert;
DROP TRIGGER activity_host_invite_delete;
DROP TRIGGER activity_host_delete;
CREATE TABLE comment_activity_receipt_backup AS SELECT * FROM activity_read_state;
CREATE TABLE comment_activity_push_backup AS SELECT * FROM push_delivery;
-- A host's copy of their own update blast has no version and is not cascaded.
CREATE TABLE comment_activity_email_backup AS SELECT * FROM email_delivery WHERE version IS NOT NULL;
CREATE TABLE activity_source_next (
  recipient_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES membership(user_id),
  kind TEXT NOT NULL CHECK(kind IN ('request','follower','joined','likes','comment','event_response','event_message','host_invite','host_accepted','post','thread_comment','comment_like')),
  post_id TEXT REFERENCES post(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id,event_key,actor_id)
);
INSERT INTO activity_source_next SELECT * FROM activity_source;
-- Cascades temporarily remove receipts and deliveries; restore them below.
DROP TABLE activity_source;
ALTER TABLE activity_source_next RENAME TO activity_source;
CREATE INDEX activity_page ON activity_source(recipient_id,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_kind_page ON activity_source(recipient_id,kind,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_group_page ON activity_source(recipient_id,event_key,created_at DESC,actor_id DESC);
CREATE INDEX activity_post ON activity_source(post_id);
-- Post alerts are retired once their queued delivery has expired.
CREATE INDEX activity_post_alert_age ON activity_source(created_at) WHERE kind='post';

INSERT INTO activity_read_state SELECT * FROM comment_activity_receipt_backup;
INSERT INTO push_delivery SELECT * FROM comment_activity_push_backup;
INSERT INTO email_delivery SELECT * FROM comment_activity_email_backup;
DROP TABLE comment_activity_receipt_backup;
DROP TABLE comment_activity_push_backup;
DROP TABLE comment_activity_email_backup;

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

CREATE TRIGGER activity_follow_insert AFTER INSERT ON follow BEGIN
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

CREATE TRIGGER activity_host_invite_insert AFTER INSERT ON event_host_member_invite BEGIN
  DELETE FROM activity_source WHERE recipient_id=NEW.user_id AND event_key='host_invite:'||NEW.event_id;
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT NEW.user_id,'host_invite:'||NEW.event_id,NEW.invited_by,'host_invite',NULL,NEW.created_at
  WHERE EXISTS(SELECT 1 FROM membership WHERE user_id=NEW.user_id)
    AND EXISTS(SELECT 1 FROM membership WHERE user_id=NEW.invited_by);
  UPDATE activity_read_state SET is_read=1
  WHERE recipient_id=NEW.user_id AND event_key='host_invite:'||NEW.event_id
    AND EXISTS(SELECT 1 FROM event_access WHERE event_id=NEW.event_id AND user_id=NEW.user_id
      AND hosting_declined_at IS NOT NULL);
END;

CREATE TRIGGER activity_host_invite_delete AFTER DELETE ON event_host_member_invite BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.user_id AND event_key='host_invite:'||OLD.event_id
    AND NOT EXISTS(SELECT 1 FROM event_host WHERE event_id=OLD.event_id AND user_id=OLD.user_id);
  UPDATE activity_read_state SET is_read=1
  WHERE recipient_id=OLD.user_id AND event_key='host_invite:'||OLD.event_id;
  DELETE FROM activity_source WHERE recipient_id=OLD.invited_by
    AND event_key='host_accepted:'||OLD.event_id||'.'||OLD.user_id AND actor_id=OLD.user_id
    AND EXISTS(SELECT 1 FROM event_host WHERE event_id=OLD.event_id AND user_id=OLD.user_id);
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT OLD.invited_by,'host_accepted:'||OLD.event_id||'.'||OLD.user_id,OLD.user_id,'host_accepted',NULL,unixepoch()*1000
  WHERE EXISTS(SELECT 1 FROM event_host WHERE event_id=OLD.event_id AND user_id=OLD.user_id)
    AND EXISTS(SELECT 1 FROM membership WHERE user_id=OLD.invited_by)
    AND EXISTS(SELECT 1 FROM membership WHERE user_id=OLD.user_id);
END;

CREATE TRIGGER activity_host_delete AFTER DELETE ON event_host BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.user_id AND event_key='host_invite:'||OLD.event_id;
END;

-- Publishing a photo adds 'post:<post>' for each accepted follower who wants
-- it by email, or by push on a subscribed device, so members who keep the
-- default write nothing. The usual receipt triggers then queue the alerts.
CREATE TRIGGER activity_post_publish AFTER UPDATE OF state ON post
WHEN NEW.state='published' AND OLD.state!='published' BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT f.follower_id,'post:'||NEW.id,NEW.user_id,'post',NEW.id,NEW.published_at
  FROM follow f
    JOIN membership m ON m.user_id=f.follower_id AND m.status='active'
    JOIN notification_category c ON c.id='post'
    LEFT JOIN notification_preference p ON p.user_id=f.follower_id AND p.category=c.id
  WHERE f.target_id=NEW.user_id AND f.status='accepted'
    AND (COALESCE(p.email,c.email)=1 OR (COALESCE(p.push,c.push)=1
      AND EXISTS(SELECT 1 FROM push_subscription WHERE user_id=f.follower_id)))
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=f.follower_id AND target_id=NEW.user_id) OR (blocker_id=NEW.user_id AND target_id=f.follower_id))
  ON CONFLICT DO NOTHING;
END;

-- Find live participants without scanning deleted comment history.
CREATE INDEX comment_participants ON comment(post_id,user_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX activity_comment_event ON activity_source(event_key,actor_id)
  WHERE kind IN ('thread_comment','comment_like');

CREATE TRIGGER activity_thread_comment_insert AFTER INSERT ON comment
WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT c.user_id,'thread_comment:'||NEW.id,NEW.user_id,'thread_comment',NULL,NEW.created_at
  FROM comment c JOIN post p ON p.id=c.post_id AND p.state='published'
    JOIN membership m ON m.user_id=c.user_id AND m.status='active'
    JOIN membership owner ON owner.user_id=p.user_id AND owner.status='active'
    JOIN follow f ON f.follower_id=c.user_id AND f.target_id=p.user_id AND f.status='accepted'
  WHERE c.post_id=NEW.post_id AND c.deleted_at IS NULL AND c.id!=NEW.id
    AND c.user_id!=NEW.user_id AND c.user_id!=p.user_id
    AND EXISTS(SELECT 1 FROM avatar WHERE user_id=c.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE
      (blocker_id=c.user_id AND target_id IN (NEW.user_id,p.user_id))
      OR (target_id=c.user_id AND blocker_id IN (NEW.user_id,p.user_id)))
  GROUP BY c.user_id ORDER BY MAX(c.created_at) DESC,c.user_id LIMIT 500;
END;

CREATE TRIGGER activity_comment_like_insert AFTER INSERT ON comment_like BEGIN
  INSERT INTO activity_source(recipient_id,event_key,actor_id,kind,post_id,created_at)
  SELECT c.user_id,'comment_like:'||c.id||'.'||NEW.user_id,NEW.user_id,'comment_like',NULL,NEW.created_at
  FROM comment c WHERE c.id=NEW.comment_id AND c.deleted_at IS NULL AND c.user_id!=NEW.user_id;
END;
CREATE TRIGGER activity_comment_like_delete AFTER DELETE ON comment_like BEGIN
  DELETE FROM activity_source WHERE kind='comment_like'
    AND event_key='comment_like:'||OLD.comment_id||'.'||OLD.user_id AND actor_id=OLD.user_id;
END;
CREATE TRIGGER activity_comment_notifications_deleted AFTER UPDATE OF deleted_at ON comment
WHEN NEW.deleted_at IS NOT NULL BEGIN
  DELETE FROM activity_source WHERE kind IN ('thread_comment','comment_like')
    AND (event_key='thread_comment:'||OLD.id
      OR (event_key>='comment_like:'||OLD.id||'.' AND event_key<'comment_like:'||OLD.id||'/'));
END;
CREATE TRIGGER activity_comment_notifications_removed BEFORE DELETE ON comment BEGIN
  DELETE FROM activity_source WHERE kind IN ('thread_comment','comment_like')
    AND (event_key='thread_comment:'||OLD.id
      OR (event_key>='comment_like:'||OLD.id||'.' AND event_key<'comment_like:'||OLD.id||'/'));
END;

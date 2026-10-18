-- Likes stay in Activity but no longer send Web Push. Queued like alerts are
-- dropped; requests, followers, joins and comments are unchanged.
DROP TRIGGER push_activity_insert;
CREATE TRIGGER push_activity_insert AFTER INSERT ON activity_read_state BEGIN
  INSERT INTO push_delivery(subscription_id,event_key,version,created_at,available_at)
  SELECT s.id,NEW.event_key,NEW.revision,unixepoch()*1000,unixepoch()*1000
  FROM push_subscription s JOIN session a ON a.id=s.session_id
    JOIN activity_source e ON e.recipient_id=NEW.recipient_id AND e.event_key=NEW.event_key AND e.actor_id=NEW.actor_id
  WHERE s.user_id=NEW.recipient_id AND NEW.is_read=0 AND a.expiresAt>unixepoch()*1000
    AND e.kind!='likes'
  ON CONFLICT(subscription_id,event_key) DO UPDATE SET
    version=excluded.version,created_at=excluded.created_at,available_at=excluded.available_at,
    attempts=0,lease=NULL,lease_until=0;
END;
DELETE FROM push_delivery WHERE event_key LIKE 'likes:%';

-- A like joins the recipient's newest activity only when that is a like on the
-- same post; anything in between starts a new group, so groups keep their place
-- in the timeline. A post's first group keeps the 'likes:<post>' key; later
-- groups add a random suffix. Existing groups keep their keys and read state.
-- Every key for a post lies in ['likes:<post>', 'likes:<post>.').
DROP TRIGGER activity_post_like_insert;
CREATE TRIGGER activity_post_like_insert AFTER INSERT ON post_like BEGIN
  INSERT INTO activity_source
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

-- Application code never updates likes. A timestamp change keeps the group (and,
-- as before, issues a new unread receipt); changing identity re-adds the like.
DROP TRIGGER activity_post_like_update;
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
  INSERT INTO activity_source
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

DROP TRIGGER activity_post_like_delete;
CREATE TRIGGER activity_post_like_delete AFTER DELETE ON post_like BEGIN
  DELETE FROM activity_source
  WHERE recipient_id=(SELECT user_id FROM post WHERE id=OLD.post_id)
    AND event_key>='likes:'||OLD.post_id AND event_key<'likes:'||OLD.post_id||'.'
    AND actor_id=OLD.user_id;
END;

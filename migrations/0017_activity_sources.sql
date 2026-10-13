-- An index of interaction sources, never a substitute for current authorization.
-- Triggers commit with the originating mutation, including older deployed clients.
CREATE TABLE activity_source (
  recipient_id TEXT NOT NULL REFERENCES membership(user_id),
  event_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES membership(user_id),
  kind TEXT NOT NULL CHECK(kind IN ('request','likes','comment')),
  post_id TEXT REFERENCES post(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id,event_key,actor_id)
);
CREATE INDEX activity_page ON activity_source(recipient_id,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_kind_page ON activity_source(recipient_id,kind,created_at DESC,event_key DESC,actor_id DESC);
CREATE INDEX activity_group_page ON activity_source(recipient_id,event_key,created_at DESC,actor_id DESC);
CREATE INDEX activity_post ON activity_source(post_id);

INSERT INTO activity_source SELECT target_id,'request:'||follower_id,follower_id,'request',NULL,created_at FROM follow WHERE status='pending';
CREATE TRIGGER activity_follow_insert AFTER INSERT ON follow BEGIN
  INSERT INTO activity_source SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
END;
CREATE TRIGGER activity_follow_update AFTER UPDATE ON follow BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND event_key='request:'||OLD.follower_id AND actor_id=OLD.follower_id;
  INSERT INTO activity_source SELECT NEW.target_id,'request:'||NEW.follower_id,NEW.follower_id,'request',NULL,NEW.created_at WHERE NEW.status='pending';
END;
CREATE TRIGGER activity_follow_delete AFTER DELETE ON follow BEGIN
  DELETE FROM activity_source WHERE recipient_id=OLD.target_id AND event_key='request:'||OLD.follower_id AND actor_id=OLD.follower_id;
END;

INSERT INTO activity_source SELECT p.user_id,'likes:'||l.post_id,l.user_id,'likes',l.post_id,l.created_at FROM post_like l JOIN post p ON p.id=l.post_id WHERE p.user_id!=l.user_id;
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

INSERT INTO activity_source SELECT p.user_id,'comment:'||c.id,c.user_id,'comment',c.post_id,c.created_at FROM comment c JOIN post p ON p.id=c.post_id WHERE p.user_id!=c.user_id AND c.deleted_at IS NULL;
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

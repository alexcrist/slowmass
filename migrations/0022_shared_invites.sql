CREATE TABLE invite_link (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES membership(user_id),
  name TEXT NOT NULL DEFAULT '' CHECK(length(name)<=80),
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 100),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count BETWEEN 0 AND max_uses),
  revoked_at INTEGER
);
CREATE INDEX invite_link_owner ON invite_link(inviter_id,created_at DESC,id DESC);
CREATE INDEX invite_link_cleanup ON invite_link(expires_at) WHERE token_encrypted IS NOT NULL;
ALTER TABLE invitation ADD COLUMN invite_link_id TEXT REFERENCES invite_link(id);
CREATE INDEX invitation_link ON invitation(invite_link_id,created_at DESC,id DESC);
CREATE TRIGGER invitation_link_immutable BEFORE UPDATE OF invite_link_id ON invitation BEGIN
  SELECT RAISE(ABORT,'immutable_invitation_link');
END;
CREATE TRIGGER invite_link_immutable BEFORE UPDATE OF id,inviter_id,token_hash,created_at,max_uses,expires_at ON invite_link BEGIN
  SELECT RAISE(ABORT,'immutable_invite_link');
END;
-- Claims bind a library-owned, one-time email verification to a specific link.
-- Requesting email never reserves or consumes capacity.
CREATE TABLE invite_link_claim (
  token_hash TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE,
  invite_link_id TEXT NOT NULL REFERENCES invite_link(id),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX invite_link_claim_expiry ON invite_link_claim(expires_at);
CREATE INDEX invite_link_claim_email ON invite_link_claim(email);
CREATE TRIGGER membership_validate_link BEFORE INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM invitation i WHERE i.id=NEW.invitation_id AND i.invite_link_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM invite_link l WHERE l.id=i.invite_link_id
        AND l.inviter_id=NEW.invited_by AND l.revoked_at IS NULL
        AND l.expires_at>NEW.joined_at AND l.used_count<l.max_uses)
  ) THEN RAISE(ABORT,'invite_link_unavailable') END;
END;
CREATE TRIGGER membership_consume_link AFTER INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL BEGIN
  UPDATE invite_link SET used_count=used_count+1 WHERE id=(SELECT invite_link_id FROM invitation WHERE id=NEW.invitation_id);
END;
DROP TRIGGER profile_invitation_follows;
CREATE TRIGGER profile_invitation_follows AFTER INSERT ON profile BEGIN
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT child.user_id,parent.user_id,'accepted',NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN invitation i ON i.id=child.invitation_id AND i.invite_link_id IS NULL
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT parent.user_id,child.user_id,'accepted',NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN invitation i ON i.id=child.invitation_id AND i.invite_link_id IS NULL
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
END;

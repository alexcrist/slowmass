-- Shared links have not been used. Abort rather than discard unexpected joins.
CREATE TABLE invite_link_migration_guard (redemptions INTEGER CHECK(redemptions=0), claims INTEGER CHECK(claims=0));
INSERT INTO invite_link_migration_guard SELECT
  (SELECT COUNT(*) FROM invitation WHERE invite_link_id IS NOT NULL),
  (SELECT COUNT(*) FROM invite_link_claim);
DROP TABLE invite_link_migration_guard;

DROP TRIGGER membership_validate_link;
DROP TRIGGER membership_consume_link;
DROP TRIGGER invitation_link_immutable;
DROP TRIGGER profile_invitation_follows;
DROP INDEX invitation_link;
ALTER TABLE invitation DROP COLUMN invite_link_id;
ALTER TABLE invitation ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal' CHECK(kind IN ('personal','shared'));
DROP INDEX invitation_inviter_created;
CREATE INDEX invitation_personal_owner ON invitation(inviter_id,created_at DESC,id DESC) WHERE kind='personal';
CREATE TRIGGER invitation_kind_immutable BEFORE UPDATE OF kind ON invitation BEGIN
  SELECT RAISE(ABORT,'immutable_invitation_kind');
END;

DROP TABLE invite_link_claim;
DROP TABLE invite_link;
-- The ID identifies this credential version, not a permanent invitation.
CREATE TABLE invite_link (
  inviter_id TEXT NOT NULL PRIMARY KEY REFERENCES membership(user_id),
  id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  revoked_at INTEGER
);
CREATE INDEX invite_link_cleanup ON invite_link(expires_at) WHERE token_encrypted IS NOT NULL;
CREATE TRIGGER invite_link_owner_immutable BEFORE UPDATE OF inviter_id ON invite_link BEGIN
  SELECT RAISE(ABORT,'immutable_invite_link_owner');
END;
-- Keep failed claims until expiry so auth cannot fall back to another inviter.
-- Version and credential hash both pin an email to the exact requested link.
CREATE TABLE invite_link_claim (
  token_hash TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE,
  inviter_id TEXT NOT NULL REFERENCES membership(user_id),
  invite_link_id TEXT NOT NULL,
  invite_link_token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX invite_link_claim_expiry ON invite_link_claim(expires_at);
CREATE INDEX invite_link_claim_email ON invite_link_claim(email);
CREATE TRIGGER membership_validate_link BEFORE INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM invitation i WHERE i.id=NEW.invitation_id AND i.kind='shared'
      AND NOT EXISTS (
        SELECT 1 FROM invite_link_claim c JOIN invite_link l ON l.inviter_id=c.inviter_id
          AND l.id=c.invite_link_id AND l.token_hash=c.invite_link_token_hash
        JOIN membership parent ON parent.user_id=l.inviter_id AND parent.status='active'
        JOIN avatar a ON a.user_id=l.inviter_id
        WHERE c.invitation_id=i.id AND c.inviter_id=NEW.invited_by AND c.email=i.recipient_email
          AND c.expires_at>NEW.joined_at AND l.expires_at>NEW.joined_at AND l.revoked_at IS NULL
      )
  ) THEN RAISE(ABORT,'invite_link_unavailable') END;
END;
CREATE TRIGGER profile_invitation_follows AFTER INSERT ON profile BEGIN
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT child.user_id,parent.user_id,'accepted',NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN invitation i ON i.id=child.invitation_id AND i.kind='personal'
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT parent.user_id,child.user_id,'accepted',NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN invitation i ON i.id=child.invitation_id AND i.kind='personal'
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
END;

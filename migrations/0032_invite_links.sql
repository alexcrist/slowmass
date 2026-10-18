-- Invite links return beside event links. Each member keeps the one renewable
-- invite_link row from 0025 (0030 revoked every credential). A join through
-- one now records the exact link version, as event joins do, so a burst of
-- sign-ups can be traced to the link that admitted it. Invite-link joins from
-- before 0030 keep a NULL version.
ALTER TABLE invitation ADD COLUMN invite_link_id TEXT;
CREATE INDEX invitation_invite_link ON invitation(invite_link_id) WHERE invite_link_id IS NOT NULL;
CREATE TRIGGER invitation_invite_link_immutable BEFORE UPDATE OF invite_link_id ON invitation BEGIN
  SELECT RAISE(ABORT,'immutable_invitation_link');
END;
-- 0030's checks, with the invitation's recorded version pinned to the claim.
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
        WHERE i.event_id IS NULL AND i.invite_link_id=c.invite_link_id
          AND c.invitation_id=i.id AND c.inviter_id=NEW.invited_by
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

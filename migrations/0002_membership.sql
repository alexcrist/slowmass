-- Invitation provenance is retained independently of disposable sessions.
CREATE TABLE membership (
  user_id TEXT PRIMARY KEY REFERENCES user(id),
  invited_by TEXT REFERENCES membership(user_id),
  invitation_id TEXT UNIQUE REFERENCES invitation(id),
  joined_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  CHECK ((invited_by IS NULL) = (invitation_id IS NULL)),
  CHECK (invited_by IS NULL OR invited_by != user_id)
);
CREATE UNIQUE INDEX membership_one_root ON membership ((1)) WHERE invited_by IS NULL;
CREATE INDEX membership_inviter ON membership(invited_by);
CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES membership(user_id),
  recipient_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT UNIQUE REFERENCES membership(user_id),
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);
CREATE INDEX invitation_recipient ON invitation(recipient_email, created_at, id);
CREATE INDEX invitation_inviter_created ON invitation(inviter_id, created_at);
CREATE TRIGGER membership_validate_invitation BEFORE INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invitation i
    JOIN membership inviter ON inviter.user_id = i.inviter_id
    JOIN user recipient ON recipient.id = NEW.user_id
    WHERE i.id = NEW.invitation_id AND i.inviter_id = NEW.invited_by
      AND inviter.status = 'active' AND recipient.emailVerified = 1
      AND lower(recipient.email) = i.recipient_email
      AND i.accepted_by IS NULL AND i.revoked_at IS NULL
      AND i.expires_at > NEW.joined_at
  ) THEN RAISE(ABORT, 'invalid_invitation') END;
END;
CREATE TRIGGER membership_accept_invitation AFTER INSERT ON membership
WHEN NEW.invitation_id IS NOT NULL
BEGIN
  UPDATE invitation SET accepted_by = NEW.user_id WHERE id = NEW.invitation_id;
END;
CREATE TRIGGER membership_immutable_provenance BEFORE UPDATE OF user_id, invited_by, invitation_id, joined_at ON membership
BEGIN
  SELECT RAISE(ABORT, 'immutable_membership_provenance');
END;
CREATE TRIGGER invitation_immutable_provenance BEFORE UPDATE OF id, inviter_id, recipient_email, created_at ON invitation
BEGIN
  SELECT RAISE(ABORT, 'immutable_invitation_provenance');
END;

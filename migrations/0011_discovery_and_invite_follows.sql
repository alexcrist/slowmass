-- Stable random keys allow shuffled, cursor-paginated discovery without random sorting.
ALTER TABLE profile ADD COLUMN discovery_key TEXT NOT NULL DEFAULT '';
UPDATE profile SET discovery_key=lower(hex(randomblob(16)));
CREATE UNIQUE INDEX profile_discovery ON profile(discovery_key);
CREATE TRIGGER profile_discovery_key AFTER INSERT ON profile
BEGIN
  UPDATE profile SET discovery_key=lower(hex(randomblob(16))) WHERE user_id=NEW.user_id;
END;
-- Consent to an invitation establishes mutual follows once both profiles exist.
-- Only initial profile creation triggers this; edits/sign-ins never restore removed follows.
CREATE TRIGGER profile_invitation_follows AFTER INSERT ON profile
BEGIN
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT child.user_id, parent.user_id, 'accepted', NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
  INSERT OR IGNORE INTO follow(follower_id,target_id,status,created_at)
  SELECT parent.user_id, child.user_id, 'accepted', NEW.created_at
  FROM membership child JOIN membership parent ON parent.user_id=child.invited_by
  JOIN profile cp ON cp.user_id=child.user_id JOIN profile pp ON pp.user_id=parent.user_id
  WHERE child.status='active' AND parent.status='active'
    AND (child.user_id=NEW.user_id OR parent.user_id=NEW.user_id)
    AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=child.user_id AND target_id=parent.user_id) OR (blocker_id=parent.user_id AND target_id=child.user_id));
END;

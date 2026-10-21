-- Member-to-member co-host invitations replace emails. Keep the old table
-- intact so the previous Worker remains compatible if deployment fails.
CREATE TABLE event_host_member_invite (
  event_id TEXT NOT NULL REFERENCES event(id),
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK(user_id != invited_by),
  PRIMARY KEY(event_id,user_id)
);

CREATE INDEX event_host_member_invite_user ON event_host_member_invite(user_id,event_id);

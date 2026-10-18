-- Co-hosts. Any host adds someone by email; they become a host the next time
-- they view the event signed in with that email and a profile photo, so adding
-- never reveals whether an account uses the address. Pending emails are shown
-- only to hosts and are removed on promotion, by a host, or once the event ends.
CREATE TABLE event_host_invite (
  event_id TEXT NOT NULL REFERENCES event(id),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(trim(email))),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,email)
);

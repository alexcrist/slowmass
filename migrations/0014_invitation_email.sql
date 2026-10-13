-- Issuance provenance remains immutable; delivery timestamps are separate.
ALTER TABLE invitation ADD COLUMN email_payload TEXT;
ALTER TABLE invitation ADD COLUMN email_attempted_at INTEGER;
ALTER TABLE invitation ADD COLUMN email_last_attempt_at INTEGER;
ALTER TABLE invitation ADD COLUMN email_sent_at INTEGER;
CREATE INDEX invitation_pending_email ON invitation(email_attempted_at)
  WHERE email_payload IS NOT NULL;

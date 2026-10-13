-- Join credentials are independent of the public invitation ID and normal login links.
ALTER TABLE invitation ADD COLUMN join_token_hash TEXT;
CREATE UNIQUE INDEX invitation_join_token ON invitation(join_token_hash)
  WHERE join_token_hash IS NOT NULL;

-- Old unconfirmed emails contain no credential. The new delivery version freezes
-- an encrypted payload with a join link and uses a separate provider deduplication key.
UPDATE invitation SET email_payload=NULL WHERE email_payload IS NOT NULL;

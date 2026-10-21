-- Manual: audit alias collisions and take a backup before applying. Never merge accounts here.
CREATE UNIQUE INDEX user_email_identity ON user (
CASE WHEN lower(substr(trim(email),instr(trim(email),'@')+1)) IN ('gmail.com','googlemail.com') THEN replace(substr(substr(lower(trim(email)),1,instr(trim(email),'@')-1),1,instr(substr(lower(trim(email)),1,instr(trim(email),'@')-1)||'+','+')-1),'.','')||'@gmail.com' ELSE lower(trim(email)) END
);

-- A provider subject belongs to exactly one account, including concurrent callbacks.
CREATE UNIQUE INDEX account_provider_identity ON account(providerId,accountId);

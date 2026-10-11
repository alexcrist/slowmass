-- Existing objects are conservatively charged the maximum upload size until removed.
CREATE TABLE stored_object (
 object_key TEXT PRIMARY KEY,
 user_id TEXT REFERENCES membership(user_id),
 bytes INTEGER NOT NULL CHECK(bytes>=0),
 created_at INTEGER NOT NULL
);
CREATE INDEX stored_object_user ON stored_object(user_id);
INSERT INTO stored_object(object_key,user_id,bytes,created_at)
 SELECT object_key,user_id,8388608,0 FROM post WHERE object_key IS NOT NULL
 UNION SELECT object_key,user_id,8388608,0 FROM avatar;
INSERT OR IGNORE INTO stored_object(object_key,user_id,bytes,created_at)
 SELECT object_key,NULL,8388608,0 FROM photo_cleanup;
CREATE TABLE storage_budget (
 id INTEGER PRIMARY KEY CHECK(id=1),
 used_bytes INTEGER NOT NULL CHECK(used_bytes>=0),
 limit_bytes INTEGER NOT NULL CHECK(limit_bytes>=0)
);
INSERT INTO storage_budget SELECT 1,COALESCE(SUM(bytes),0),8000000000 FROM stored_object;
CREATE TABLE account_deletion (
 user_id TEXT PRIMARY KEY REFERENCES membership(user_id),
 requested_at INTEGER NOT NULL,
 email_to_redact TEXT,
 completed_at INTEGER
);
CREATE INDEX account_deletion_pending ON account_deletion(completed_at,requested_at);

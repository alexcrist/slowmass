-- Dismiss only this source version's prompt; reading and following stay separate.
-- Source removal cascades receipt cleanup, and a later follow gets a fresh prompt.
ALTER TABLE activity_read_state ADD COLUMN follow_back_dismissed INTEGER NOT NULL DEFAULT 0 CHECK(follow_back_dismissed IN (0,1));

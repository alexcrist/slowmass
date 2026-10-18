-- Offer optional device setup in Activity to active members who joined before
-- migration 0027 reopened production (2026-10-14T01:07:07.027Z). Later members
-- received a pending row on joining; a missing row means they finished or
-- declined the earlier onboarding offer, and that answer stays respected.
INSERT OR IGNORE INTO device_setup(user_id)
SELECT user_id FROM membership
WHERE status='active' AND joined_at<1791940027027;

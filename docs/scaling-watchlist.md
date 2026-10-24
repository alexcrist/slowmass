# Scaling watchlist

Known costs that are negligible at current usage but grow with it. Each entry says where the cost comes from, how to tell it matters, and the planned fix. Nothing here is scheduled; revisit when usage grows quickly or a measurement crosses the stated signal.

## Hidden unread notifications

Recorded October 24, 2026, from the notification audit.

**Cause.** An unread Activity item stays unread after its author is hidden from the recipient: either one blocks the other, or the author's membership is disabled. Activity, the badge, push, and email recheck visibility on every read, so nothing leaks. But the hidden item can never be shown, so it can never be marked read.

**Cost.** The badge count scans the recipient's unread receipts (partial index `activity_unread`) and checks visibility for each. Hidden receipts are skipped on every check, which happens on navigation, focus, reconnect, and once a minute while the app is visible. The cost grows with how many hidden unread items a member has accumulated. It is near zero unless someone who interacted heavily is blocked or disabled.

**Signal.** Count hidden unread receipts per recipient:

```sql
SELECT r.recipient_id, COUNT(*) AS hidden
FROM activity_read_state r
WHERE r.is_read=0 AND (
  NOT EXISTS(SELECT 1 FROM membership m WHERE m.user_id=r.actor_id AND m.status='active')
  OR EXISTS(SELECT 1 FROM block b WHERE (b.blocker_id=r.recipient_id AND b.target_id=r.actor_id)
    OR (b.blocker_id=r.actor_id AND b.target_id=r.recipient_id)))
GROUP BY r.recipient_id ORDER BY hidden DESC LIMIT 20;
```

Act when some members have hundreds, or when D1 rows read by the unread-count route climb faster than active members.

**Fix.** Add a migration with two triggers: creating a block marks unread receipts between the two members as read, and disabling a membership marks that member's receipts to others as read. Unblocking or re-enabling would then not restore old items as unread, which is acceptable. Do not touch receipts hidden only because a profile photo is missing; those become visible once the photo is added.

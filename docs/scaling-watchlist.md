# Scaling watchlist

Known costs that are negligible at current usage but grow with it. Each entry says where the cost comes from, how to tell it matters, and the planned fix. Nothing here is scheduled; revisit when usage grows quickly or a measurement crosses the stated signal.

## Hidden unread notifications

Recorded October 24, 2026, from the notification audit.

**Cause.** An unread Activity item stays unread after its author is hidden from the recipient: either one blocks the other, or the author's membership is disabled. Activity, the badge, push, and email recheck visibility on every read, so nothing leaks. But the hidden item can never be shown, so it can never be marked read.

**Cost.** The badge count scans the recipient's unread receipts (partial index `activity_unread`) and checks visibility for each; current clients also request the unread key list, a second scan of the same receipts in the same request. Hidden receipts are skipped on every check, which happens on navigation, focus, reconnect, and once a minute while the app is visible. The cost grows with how many hidden unread items a member has accumulated. It is near zero unless someone who interacted heavily is blocked or disabled.

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

## New-photo alert fan-out

Recorded October 27, 2026, when new-photo alerts shipped.

**Cause.** Publishing a photo writes an activity source, receipt and queued push or email for every accepted follower who opted in, in the publication's transaction. These rows are never read in Activity, so they stay unread until the 15-minute cron deletes them two days later. Meanwhile the badge count seeks them among the member's unread receipts and skips them.

**Cost.** Rows written per publication grow with opted-in followers; badge reads grow with how many photos opted-in members' follows post in two days. Both are near zero while the category is off by default.

**Signal.** Opted-in members and live post alerts:

```sql
SELECT COUNT(*) FROM notification_preference WHERE category='post' AND (push=1 OR email=1);
SELECT COUNT(*) FROM activity_source WHERE kind='post';
```

Act when live post alerts exceed what one cleanup run per 15 minutes removes (1,000), or when publication rows written climb faster than posts.

**Fix.** Mark a post alert's receipt read once its last queued delivery finishes, which also takes it out of the badge's unread seek, and raise the cleanup batch.

Comment-participant activity (migration 0041) writes one source and receipt per eligible prior commenter, capped at the 500 most recent participants per new comment, plus their opted-in delivery rows. The partial participant index avoids deleted history, but selecting distinct participants still reads live comments on that post. Measure comment-insert rows read/written and CPU, and push queue age; sustained large threads need a measured participant-summary or batched fan-out design before raising the cap. Comment likes add one source/receipt per non-self like.

## Feed rereads after scrolling

Recorded November 3, 2026, when the feed and profile grids moved to loading as you scroll.

**Cause.** The client remembers how many feed pages were loaded, never their contents. Returning from a post, or deleting a post from the feed, rereads every loaded page sequentially from a new snapshot so the list stays contiguous and current. Each feed page reads up to one page plus a sentinel per eligible author before hydrating 12 posts.

**Cost.** One feed query per loaded page per return, so rows read grow with scroll depth times follows. Every other list built on `useScrollPages` (profile grids, connections, Activity, events, guests, comments, event activity) rereads the same way, after mutations as well as on return, but each of its pages is a single indexed query and costs far less.

**Signal.** Workers analytics or D1 query insights showing `/api/posts` requests per member session, or feed rows read per request, climbing well above the page count members actually view.

**Fix.** Cap the reread depth, for example by rereading only the last few pages from the remembered cursor before them instead of the whole chain, accepting that earlier rows come from the older snapshot.

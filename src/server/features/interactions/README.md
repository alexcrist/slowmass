# Likes and comments

One like per member/post is enforced by the primary key. Repeated like/unlike requests are idempotent. Comment UUIDs identify retries; changing content under the same ID is rejected. Authors and post owners can delete comments; the row remains as a content-free tombstone to prevent replay and retain quota accounting. Members may create at most 100 comments per rolling day, including subsequently deleted comments.

Every route authenticates an active member. Insert statements also check current post publication, active ownership, accepted follow, and both block directions to prevent mutation races with revocation. Comment reads repeat access checks in the data query. Author deletion remains available after losing access to the post. Deleted posts and blocked/inactive authors disappear from reads, counts, and notifications.

Comments use explicit pages of 20, newest first by server timestamp and UUID. Counts and viewer-like state are included in the posts query without per-card requests. Media authorization skips these aggregate queries. Notification reads derive current activity directly from these tables; there is no asynchronous delivery service.

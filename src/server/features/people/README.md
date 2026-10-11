# Profiles and relationships

Active verified members create a unique lowercase handle, display name, and private bio. Handles are immutable in this MVP. Authenticated exact-handle lookup reveals only a name, handle, and the viewer's relationship state until a follow is accepted. Bio and avatar existence are projected only for owners or accepted followers. Blocked and inactive accounts are hidden.

Follow requests are directional and unique. Acceptance is owner-only. Cancel/deny affects pending requests; unfollow/removal revokes accepted access. Blocking atomically removes both directions and prevents subsequent requests. Unblocking restores no relationship. Requests are capped at 100 outstanding per member. Lists are owner-scoped, sorted by immutable handle, and bounded to 20 entries with explicit cursor pagination.

Profile reads evaluate authorization in the query. Media routes use the same visibility rules before reading private bytes. A previously downloaded photo cannot be recalled. No search autocomplete, public avatars, or relationship-list access for other members exists.

# Profiles and relationships

Active verified members create a unique lowercase handle (the UI calls it a username), profile name, and private bio. Handles are immutable in this MVP. Profile lookup reveals username, name, avatar presence, and the viewer's relationship state to active members. Bios and posts require ownership or an accepted follow. Blocked and inactive accounts are hidden.

Follow requests are directional and unique. Acceptance is owner-only. Cancel/deny affects pending requests; unfollow/removal revokes accepted access. Blocking atomically removes both directions and prevents subsequent requests. Unblocking restores no relationship. Requests are capped at 100 outstanding per member. Lists are owner-scoped, sorted by immutable handle, and bounded to 20 entries with explicit cursor pagination.

Initial profile creation establishes mutual accepted follows with the inviter once both profiles exist, through migration 0011's trigger. Active membership and blocks are checked atomically. Edits never restore removed follows; existing complete profiles are not retroactively connected.

Discovery returns pages of 20 active, unblocked members excluding the viewer. Persisted random keys and a random starting seed produce a stable shuffled ring across cursor pages. Literal ordered-subsequence matching searches usernames and names case-insensitively: partials and missing letters work, arbitrary misspellings do not. Search requires at least three characters; the server limits discovery to 30 requests/member/minute. Empty queries browse the directory. Input wildcards are escaped. Search predicates can scan profiles, so inspect rows read before expanding beyond small usage; the empty directory uses indexed key ranges without random sorting.

Profile reads evaluate authorization in the query. Avatar media requires membership and no blocks; post media additionally requires accepted access. A previously downloaded photo cannot be recalled. No public avatars or relationship-list access for other members exists.

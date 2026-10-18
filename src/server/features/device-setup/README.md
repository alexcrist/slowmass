# Device setup

Tracks whether a member still may see the optional installation/notification suggestion in Activity. A row means pending; its absence means the member answered No (or finished the earlier onboarding offer). It neither grants member access nor represents notification consent, which push owns per endpoint.

Migration 0027 creates a pending row atomically with new membership and removes it when membership becomes inactive. Migration 0028 offers the suggestion once to active members who joined before 0027 reopened production; members who joined later and have no row already answered the onboarding offer, and are not asked again. Both are idempotent.

`DELETE /api/device-setup` records No for the authenticated member and is idempotent; `GET` reads the current state. Bootstrap reads pending state alongside the member's profile and whether push has any live subscription for that member. An authenticated member with a completed photo can read or answer; foreign-origin mutations, expired sessions, and unfinished profiles are rejected. Reads and writes use a single indexed member identity. A failed write leaves the row pending and the client keeps it retryable.

Previously loaded clients from before October 15 still render the retired onboarding screen when bootstrap reports pending; it remains optional and uses the same API.

Isolated Workers/D1 tests verify authentication, answers across sessions, retry idempotency, inactivity cleanup, the bootstrap subscription flag, migration 0027 preservation/rollback, and migration 0028 backfill scope. See the client device-setup feature for which step each device sees.

# Optional device setup

Tracks only whether a new member has finished the optional installation/notification offer. Migration 0027 creates a pending row atomically with new membership; existing accounts have no row and are not enrolled. Completing setup removes only the authenticated member's row and is idempotent. Inactive membership removes pending setup. It neither grants member access nor represents notification consent, which remains owned by the push feature.

Bootstrap reads this state alongside the member's profile. An authenticated member with a completed photo can check or finish setup; foreign-origin mutations, expired sessions, and unfinished profiles are rejected. Account state allows a new iOS Home Screen app to resume after cookie copying or normal sign-in, without passing credentials in a setup link. Reads and writes use a single indexed member identity. Failed writes remain retryable and the frontend does not block member access while saving.

Isolated Workers/D1 tests verify authentication, completion across sessions, retry idempotency, inactivity cleanup, and migration preservation/rollback. See the client feature for platform behavior and the setup runbook for migration sequencing.

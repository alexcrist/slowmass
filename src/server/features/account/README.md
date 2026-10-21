# Account and deletion

Account reads require a verified active session. Deletion requires the same authentication, origin protection, a bounded body, and explicit DELETE confirmation. One database batch marks membership deleted, revokes sessions and pending recipient invitations, removes matching email-link verifications and auth accounts, and anonymizes the user/profile. Invitation IDs, parent pointers, and issuance/join timestamps survive. The bootstrap root tombstone prevents a second root. Rejoining requires a fresh invitation and creates a new member identity.

Current membership checks hide photos, comments, notifications, and profiles immediately. Publication and avatar replacement also check active membership in their final SQL, so a concurrent upload cannot reactivate deleted content. Scheduled work erases up to five posts and 100 rows per ancillary table, including comment likes, for one pending account per run. It queues media deletion, redacts recipient email through a narrowly scoped trigger exception, clears pending invitation payloads for that recipient, and clears the temporary redaction address when content cleanup completes. R2 cleanup completion is tracked separately. Accepted descendants remain active; account deletion is not a mass ban.

Backups may contain earlier content until expiration. Restores are quarantined, with sessions removed and memberships disabled until the latest deletion and access decisions are reconciled. See the operations runbook; never restore a stale snapshot directly into public service.

`/api/bootstrap` combines sign-in availability, the current verified active session, that member's own profile, pending optional device setup, and whether the member has any live push subscription. The three member reads run concurrently after authentication. Anonymous or expired sessions return a null user/profile; service/database failures remain errors rather than false signed-out states. No response is cached. Existing `/api/me` and profile endpoints remain available for account operations and already-loaded clients.

Deletion also removes email-bound claims for the deleting account. Inactivity immediately stops their invite and event links from admitting anyone; bounded cleanup also revokes their invite link and clears its encrypted credential. Immutable link/redemption provenance, including recorded link versions, remains.

Deletion removes pending event-link claims for the email immediately. Scheduled cleanup ends events the person created (cover photos to cleanup, link ciphertext cleared, details redacted), removes hosting rows and answers, and redacts their event messages in bounded batches; completion waits for all of them.

Bootstrap also reports `googleSignInAvailable`, true only when authentication and both Google credentials are configured. This public capability flag contains no credential values and does not grant sign-in or admission. Older responses without the flag keep the client email-only.

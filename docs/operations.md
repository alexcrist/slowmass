# Operations and recovery

## Storage and spending controls

Photo storage is capped in application code at 8 GB total and 250 MB per member (decimal bytes). Actual processed bytes are reserved atomically before R2 writes; pending uploads and deletion backlogs remain charged. Cleanup releases capacity only after confirmed object deletion. Existing objects are conservatively charged the maximum upload size during migration. The counter must equal `SUM(stored_object.bytes)`; investigate discrepancies before enabling uploads. Do not upload objects outside the application or lower the ledger to bypass a quota.

These limits are not a Cloudflare account-wide spending cap. Other buckets, direct operator writes, R2 operations, and provider plan changes are outside them. Existing processing budgets remain five attempts/member/day, 150/day across the app, and 3,500/month. Backups are local encrypted files, adding no hosted backup storage or idle service. Do not enable paid plans automatically.

Cleanup runs every 15 minutes. Each invocation processes one account (five posts and up to 100 rows per ancillary table), two avatar objects, and two post objects. It also prunes bounded batches of expired sessions, email-link records, email budgets, and old processing attempts. Backlogs preserve privacy and remain charged to quota; inspect them if storage is unexpectedly full. Account content cleanup completion does not imply every queued R2 object has been physically deleted.

## Usage inspection

With Node 24 and Wrangler authenticated, run:

```sh
node scripts/ops/usage.mjs
npx wrangler d1 insights slowmass --env production --timePeriod 1d
npx wrangler d1 execute slowmass --env production --remote --command "SELECT used_bytes,limit_bytes,(SELECT COALESCE(SUM(bytes),0) FROM stored_object) AS ledger_bytes FROM storage_budget; SELECT COUNT(*) AS pending_objects,MIN(not_before) AS oldest_due FROM photo_cleanup;"
```

The usage tool retrieves aggregate Worker requests/errors/CPU, D1 reads/writes, and the latest R2 size observation. Cloudflare may sample or delay these metrics. Worker CPU quantiles are in microseconds. An empty dataset is not evidence of zero usage. No request bodies, email addresses, tokens, captions, or behavioral analytics are collected by this tool. The app does not enable persistent request logs; error messages contain only request IDs and error types.

Review usage during the initial beta and before expanding invitations. Investigate at 50% of any provider allowance; plan changes at 75%; stop expansion at 90%. For application storage, those points are 4/6/7.2 GB. Observe R2 across the entire account as well. Investigate sustained CPU near the current plan ceiling, resource-limit errors, or growing deletion queues before inviting more users. Upgrade only after measuring and obtaining the account owner's choice.

## Backup creation and retention

Use a private directory outside the repository, a random 32-byte key in a separate mode-600 file, and a new output filename each time:

```sh
node scripts/ops/backup.mjs /private/path/slowmass-YYYY-MM-DD.enc /private/path/backup.key
node scripts/ops/restore-check.mjs /private/path/slowmass-YYYY-MM-DD.enc /private/path/backup.key
```

The backup includes a D1 SQL export, referenced published post/avatar bytes, checksums, and a capture timestamp. Missing media causes failure. It is an application snapshot, not an atomic transaction spanning D1/R2: if concurrent deletion removes a referenced object, retry after the operation settles. Encrypted archives and keys must not enter the public repository. Plaintext temporary directories are mode 700 and removed after the command finishes; archives are mode 600. A killed process may require removing its private temporary directory manually.

Current operation is **manual**: take a backup daily while people are using the app and before migrations. Verify it, then copy it off this Mac. Keep archives no more than seven days, replacing the oldest only after a newer verified copy exists; manually delete expired copies from the Mac and Google Drive, including Drive trash. A recovery kit containing both an archive and its key is sensitive as a whole—keep its Drive access private. No automatic local schedule or Drive upload has been configured. The requested handoff is a clearly named ZIP for the owner to copy.

The latest verified snapshot defines recoverable data. With daily successful copies, the target is at most 24 hours of lost new content; a missed backup extends that window. This is a target, not a verified recovery-time guarantee. D1 Time Travel provides an additional provider-managed recovery path, not an R2 backup.

## Recovery without resurrecting deleted content

1. Enable `MAINTENANCE_MODE=true` in a deployment before any recovery. API and media access return 503 and scheduled mutation work stops. Keep the site closed throughout reconciliation.
2. Preserve a fresh copy of the current database and deletion decisions if available. A stale snapshot cannot tell you about later deletions, removed followers, or blocks. Use the newest authoritative records, not an older backup's membership state.
3. Run the encrypted restore checker. It verifies ciphertext authentication, SQL integrity/foreign keys, and every photo checksum in disposable local storage. It clears sessions and pending email links and disables active memberships in the restored copy. It never modifies production.
4. Restore into isolated resources first. Reapply current account, post, and comment deletion records, avatar removals, and follow/block decisions. Queue removed objects; preserve invitation IDs, ancestry, and issuance/join times. Rebuild the byte ledger from objects actually retained and include cleanup reservations. Do not simply restore old `storage_budget` values into a bucket containing different objects.
5. Validate permissions, object checksums, invitation provenance, and cleanup through API/database checks. If current deletion/access decisions cannot be recovered, keep affected accounts disabled; do not silently reactivate them from an old snapshot. Keep expired sessions invalid and use a fresh auth secret if restoring after credential loss.
6. Only reopen accounts whose current access state has been reconciled. Remove maintenance mode in an explicit deployment after validation. The restore checker is deliberately not a one-command production overwrite tool.

The automated exercise verifies an encrypted synthetic SQL/photo archive and rejects tampered ciphertext. The initial production archive contains no photos, so its successful restore establishes database recovery only; synthetic fixtures establish the media path. Hosted Time Travel drill results are recorded below when observed. A complete application cutover after disaster remains an operator procedure, not an automated guarantee.

## Release and rollback

Run `npm run check`, create/verify a backup, and apply migrations before dependent code serves traffic. For storage-ledger initialization, deploy the checked code in maintenance mode first, allow existing requests to drain, apply migrations, and redeploy without maintenance. Trigger migrations may require the documented atomic file-import workaround; include their `d1_migrations` entries in the same import. Never edit an applied migration.

Prefer code rollback with forward-compatible schema. Do not roll back to code that permits unmetered uploads after enabling storage limits, or that ignores deleted memberships. Maintain the maintenance gate if correctness is uncertain. No automatic production deployment is enabled.

## Initial usage observation — October 10, 2026

At approximately 19:20 PDT, the preceding 24-hour metrics reported 34 Worker requests (33 success, one client disconnect), zero reported errors, 2,601 D1 rows read, 154 rows written, and zero R2 objects/bytes in the latest available bucket observation. Successful invocations had CPU P50 4.957 ms and P99 56.173 ms. The sample is very small, contains setup/auth traffic, and predates the auth-instance reuse change. It does not establish an authenticated-photo capacity estimate or demonstrate every request fits the free CPU ceiling. Auth instances are now reused per environment to avoid repeated initialization; measure the effect with subsequent real traffic.

Sources: [Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/), [R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/), and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

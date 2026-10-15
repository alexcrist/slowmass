# External setup

Status: the production Worker is deployed at https://slowmass.com with D1 and a private R2 bucket. Resend domain verification and first-member sign-in are complete. Use `--env production` for hosted operations; the default configuration remains local-only with a placeholder database ID.

## Cloudflare

Production fetch execution uses a Washington-region placement hint in Wrangler. After deployment, verify the `cf-placement` response header and compare `Server-Timing` on database-backed routes. Cloudflare selects the data center dynamically near the hint; this is not a Seattle residency guarantee. D1 and R2 retain their separate storage locations. See the dated placement rollout in the operations runbook for measurements and rollback.

From this repository, with Node.js 24 active:

```sh
npx wrangler login
npx wrangler whoami
```

Complete browser authorization using the account that owns slowmass.com. Keep tokens out of chat and source control. The implementation agent can then inspect the account, create the D1 database and private R2 bucket, replace the placeholder binding, and configure the production origin/domain. R2 may require billing activation even within free allowances; complete any account-owner action in Cloudflare's dashboard.

Production HTTPS enforcement is configured in Cloudflare under **SSL/TLS → Edge Certificates**, outside Wrangler: **Always Use HTTPS** is on, and **HSTS** is enabled for six months (`max-age=15552000`), with **Include subdomains** and **Preload** off. HTTP requests redirect to the same HTTPS path and query; HTTPS responses include HSTS for static assets, API responses, and media errors. These settings persist across app deployments. Verify redirects and headers with direct HTTP requests after changing domain or TLS configuration. Keep HTTPS available while browsers retain the HSTS policy.

The production Images binding processes private photo bytes. Remote checks verified JPEG orientation and metadata removal, still PNG/WebP conversion, animation rejection, and the complete avatar API using isolated local D1/R2 with remote image processing. The quarter-hour cleanup schedule removes replaced/orphaned avatar and post objects in bounded batches. A direct post API check with real processing also passed against isolated synthetic D1/R2. Hosted CPU measurements and the full deployed multi-user flow remain open. No paid Workers or Images subscription has been enabled. R2 is activated with its usage-based billing and included allowances.

## Email delivery

Create a Resend account on its Free plan. Add slowmass.com as a sending domain and install its verification DNS records in Cloudflare. Keep open and click tracking disabled. Create a sending-only API key scoped to that domain where supported.

In the ignored `.dev.vars` file, enter the API key and your desired sending address. Use `EMAIL_REPLY_TO` for an optional personal reply inbox; Gmail can receive replies but cannot be used as the Resend sender. Set `BOOTSTRAP_EMAIL` to the address you will use for the first account. Its first successful email verification establishes the root member. Once any membership exists, this setting cannot create another root. Every later member requires an active member's invitation.

The implementation agent has generated a local auth secret in `.dev.vars`. On a fresh checkout, copy `.dev.vars.example` and generate one using `openssl rand -base64 32`. Do not paste credentials into chat. Production secrets must be installed through Wrangler's secret input; production needs a distinct auth secret and verified HTTPS origin.

Use the actual sender domain/address verified by Resend. The provider's sandbox sender cannot deliver broadly to friends. The application caps email delivery attempts below the provider's current free daily allowance; provider billing settings remain authoritative. Do not enable automatic paid overages as part of setup.

## Migrations

`npm run db:migrate` applies checked-in migrations to local D1. The auth schema is generated from the installed Better Auth library; membership and email-budget migrations are application-owned. `npm run auth:schema` prints a reference auth schema for review without applying it. Do not replace an applied migration; add forward migrations when the schema changes.

## Next verification gate

After credentials are available, verify a real email link, first-member bootstrap, invited/uninvited joins, logout, private image processing, metadata removal, rejected formats, and deployed Worker CPU consumption. Local simulated email tests do not substitute for hosted delivery or runtime verification. Keep that implementation-plan gate open until observed.

## Provider references

- [Resend sender domain setup](https://resend.com/docs/dashboard/domains/introduction)
- [Resend pricing](https://resend.com/pricing)
- [Better Auth email-link integration](https://better-auth.com/docs/plugins/magic-link)

## Local test isolation

Browser and visual testing are prohibited. Integration tests run isolated Workers/D1/R2 with synthetic accounts and intercept or reject external network requests. They never load `.dev.vars`, send real email, or access production data.

## Production deployment

The GitHub Actions `Checks` workflow deploys pushes to `main` after formatting, lint, types, boundary/unit/integration tests, the frontend build, and local migrations succeed. Pull requests and other branches only run checks. The production job downloads the exact frontend build from the check job, installs locked dependencies, verifies production migration history, and deploys through the repository's Wrangler version. Deployments are serialized without interrupting an active release; a queued commit is skipped if it is no longer the current `main` commit. A newer push during deployment is handled by the next successful run.

GitHub requires the repository variable `CLOUDFLARE_ACCOUNT_ID` and Actions secret `CLOUDFLARE_API_TOKEN`. The `production` environment restricts deployments to the `main` branch. Create a dedicated token scoped to the owning account with Workers Scripts Write, Account Settings Read, D1 Read and Workers R2 Storage Read, plus Workers Routes Write scoped to slowmass.com. Keep the token in GitHub's encrypted secret storage, never source or logs; do not upload a personal Wrangler OAuth session. See [Cloudflare's CI authentication guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

The migration gate reads only `d1_migrations` and stops on pending migrations, unknown applied migrations, missing credentials, or invalid provider output. It does not apply production migrations. Follow the backup and migration runbook before deploying schema changes, then rerun the latest `main` workflow. Before maintenance, recovery, or a manual rollback, set the repository variable `AUTO_DEPLOY_DISABLED=true`, then let any running deployment finish and cancel pending releases. Clear the variable after resolving the incident and rerun the latest compatible `main` release. This switch leaves checks enabled. Never manually deploy concurrently with the production job.

After publishing, direct HTTP checks compare deployed HTML, linked JS/CSS, manifest and startup bytes with the checked build, verify sign-in availability, and check signed-out API/media rejection and no-store headers. They retry briefly for propagation. A failed check marks the job failed but does not automatically roll back code or data; inspect the published release and follow the operations runbook. These probes do not verify signed-in member flows or real-device behavior.

For an explicit operator deployment, pause automatic deployments as above, run `npm run check`, and use `npx wrangler deploy --env production`. Production has a separate auth secret installed through Wrangler, and its only public app origin is https://slowmass.com. Worker preview URLs and workers.dev access are disabled for the app. The account workers.dev subdomain exists only to allow isolated remote-binding development.

Migrations 0001–0027 are applied in production, including photo variants, comment likes, invitation email/direct joining, the Activity source index, versioned read state, Web Push, and new-follower events. Future migrations normally use `npx wrangler d1 migrations apply slowmass --env production --remote`.

### Initial trigger migration workaround

The hosted query endpoint rejected migration 0002 with `incomplete input`, although the unchanged migration passes locally. Its failed transaction left no membership tables. The hosted file-import endpoint successfully applied the original SQL and its migration-history entry atomically. No applied migration was edited.

For a fresh remote database that encounters this same error, first confirm 0002 is absent from `d1_migrations` and membership/invitation tables do not exist. Create a temporary SQL file containing the exact contents of `migrations/0002_membership.sql` followed by `INSERT INTO d1_migrations (name) VALUES ('0002_membership.sql');`. Apply that file with `npx wrangler d1 execute slowmass --env production --remote --file <temporary-file>`, then resume normal migrations. File import temporarily blocks database access and rolls back if it fails; do this during initial provisioning or a maintenance window.

## Latest release verification (October 10, 2026)

Worker version `869ab179-7a11-4f40-816b-cce46d422d0f` deploys photo publishing, feed, likes/comments, and notifications. The local gate passed formatting, lint, TypeScript, 54 unit/integration tests, and production build. Direct production HTTP checks returned 200 for sign-in availability, 401 for signed-out posts/comments/notifications, 404 for inaccessible media, and 403 for a foreign-origin mutation. Private responses use `private, no-store`; deployed frontend assets match the tested build. No browser or visual tests were performed. The full hosted signed-in multi-user flow, CPU measurements, and recovery readiness remain open.

## Operations release (October 10, 2026)

Worker version `d5531cc3-dd03-4666-80de-9b3788e33d15` enables account deletion and storage limits. Migrations 0009/0010 were imported atomically with migration-history records while the app was in maintenance mode; the storage counter and ledger both read zero bytes afterward. Maintenance was then removed. The release passed 59 tests, formatting/lint/types/build, and GitHub CI. Production checks confirmed sign-in availability, anonymous deletion rejection, inaccessible-media rejection, and origin enforcement.

An encrypted production SQL backup was restored and integrity-checked in private local temporary storage; it contains no photos. A synthetic image archive also passed restoration/checksum checks, and tampered ciphertext was rejected. A disposable hosted D1 database passed a bookmark/change/restore/query drill and was deleted afterward. The owner requested a single private recovery ZIP for manual Google Drive upload. See [operations](operations.md) for retention, manual backup cadence, and recovery quarantine.

## Social and navigation release (October 11, 2026)

Worker version `016a77d7-1165-49a1-be95-e2eb5e5393f9` separates profiles and Settings, fixes accumulated page content, adds photo grids and member discovery, and updates invitations, login help, and feed interactions. Magic links remain the sign-in method. Migration 0011 and its history record were imported atomically during maintenance; the discovery index and both profile triggers were verified before reopening the app.

The local check passed formatting, lint, types, 79 tests, and production build; local migrations also passed. A Node component regression test exercises repeated navigation without a browser. Direct production checks verified sign-in availability, anonymous access rejection for new endpoints and media, cross-origin mutation rejection, private response cache headers, and matching deployed HTML/JS/CSS. Authenticated social scenarios are covered in the local Workers/D1 tests; this release did not perform a signed-in multi-user production test or any browser/visual testing.

The pre-migration encrypted production backup passed local quarantined restoration with SQL integrity and both stored image checksums verified. Production was not restored. The initial recovery kit was previously copied off-device by the owner; subsequent backup creation/copying remains manual.

## White interface release (October 11, 2026)

Worker version `67f6dcad-f3c3-407b-be28-ba852ac1d06f` deploys the white canvas, neutral photo surrounds, desktop expanding sidebar, and mobile header/bottom navigation. Browser and manifest theme/background colors are white; primary buttons retain Douglas Fir. There are no database or backend behavior changes.

Formatting, lint, types, 79 existing tests, and production build passed. Direct HTTP checks confirmed the deployed HTML, CSS, JS, and manifest match the checked build and sign-in remains available. Verification used source review and CLI/component/API checks only; no browser or visual tests were performed.

## Interface cleanup release (October 11, 2026)

Worker version `e750a8ca-eac0-439c-9856-1ace8b38be40` places Settings on the member's own profile, removes its global navigation links and the manual Shuffle people control, updates invitation wording, and labels composition “New post.” HTML response headers prevent Cloudflare's injected analytics script from conflicting with the existing self-only CSP; the standard mobile web-app metadata tag is also present.

Formatting, lint, types, 79 tests, and production build passed. Direct HTTP verified exact deployed HTML/JS/CSS matches, no injected analytics script in app or branding HTML, gzip-compressed JS/CSS, available sign-in, and private/no-store responses for anonymous API/media requests. No schema changes, browser tests, or visual tests were needed.

## Loading-state release (October 11, 2026)

Worker version `e8baaef9-ebbb-4638-8756-a310532f66ad` replaces the startup login flash with a loading state until session verification completes. The audit also covers member initialization, paginated lists, profile/photo details, retries, and refreshes after mutations. A shared component-scoped read hook ignores obsolete requests and hides old read errors/results while loading. No backend, database, caching, or polling behavior changed.

Formatting, lint, types, 97 tests (including 18 new delayed-response component regressions), and production build passed. Direct HTTP confirmed the initial loading HTML, matching deployed HTML/CSS/JS, compressed assets, available sign-in, and private/no-store account responses. All checks used source review, Node components, local Workers/D1 tests, and HTTP; no browser or visual testing was performed.

## Activity and navigation release (October 11, 2026)

Worker version `0e9a9944-c3b3-4252-8bc8-012ccef8e02c` removes persistent refresh controls, adds refresh-by-tab and Settings reload, consolidates follow requests into Activity, replaces the post end label with an accessible icon, and adds secondary-page back controls. The notifications endpoint accepts an optional validated requests filter before pagination; there are no schema changes.

Formatting, lint, types, 106 tests, and production build passed. Node component checks cover tab refresh, draft preservation, filtered Activity actions, legacy request links, and end-marker semantics. Workers/D1 checks verify filtered requests hidden behind newer activity, tied cursor boundaries, resolved/blocked actors, invalid filters, and anonymous rejection. Direct HTTP confirmed matching HTML/CSS/JS, compressed assets, available sign-in, and private/no-store anonymous account/activity responses. No browser or visual testing was performed.

## Profile and onboarding release (October 11, 2026)

Worker version `df16892c-e496-4eb0-88b6-7313d8680907` includes the single paginated Activity timeline, profile tabs and contextual navigation, consistent Settings controls, and required profile photos with cropping and saving on confirmation. Unfinished profiles are excluded from member discovery and connection lists. No database migrations were pending.

Formatting, lint, types, 123 tests, and the production build passed. An encrypted production backup passed SQL integrity and both stored-image checksum checks before deployment. Direct HTTP verified matching live HTML/JS/CSS/manifest, compressed assets, available sign-in, and ten anonymous access, cache, CSP, and origin checks. No browser or visual testing was performed.

## Performance schema

Apply migration `0012_post_thumbnails.sql` before deploying the performance changes. It adds nullable thumbnail references and transformation-unit accounting, preserving existing posts and old backups. New uploads publish both variants; existing photos use a full-image fallback until bounded scheduled conversion. The prior Worker can still read the migrated schema, but keep the migration/deploy window short because old code reserves one transformation unit per upload. Migration 0012 and the current implementation are deployed; see the latest release verification below.

## Post controls and invitation email schema

Apply migrations `0013_comment_likes.sql` and `0014_invitation_email.sql` before deploying comment likes and automatic invitation email. The existing Resend key and verified sender are reused. Existing invitations retain their original timestamps and gain no automatic mail; members can explicitly send eligible invitations from history. Caption editing requires no schema change.

## Direct invitation joining

Apply migration `0016_invitation_join.sql` before deploying direct joining. It adds an indexed credential hash and clears legacy pending transport payloads without altering invitation provenance or delivery timestamps. Newly sent invitations contain a single-use Join Slowmass link; previously delivered emails remain usable through normal email sign-in. Legacy unsent retries use the new payload format and a distinct provider deduplication key. No existing invitation is automatically resent. The existing auth secret, database, and email provider are sufficient; no new accounts, secrets, or infrastructure are needed. Take and verify a production backup before the migration, following the operations runbook. Deploy only when requested.

## Activity source index

Apply migration `0017_activity_sources.sql` before deploying the design-audit fixes. It backfills an indexed directory of existing interactions and installs transactional triggers; the preceding Worker remains compatible with the schema and maintains the index through its normal writes. Existing notification cursors and read markers remain valid. Take and verify a production backup first. The migration adds database storage/index writes but requires no provider setup or service. Production migration and deployment require a user request.

## Daily invitation limit release (October 11, 2026)

Worker version `e9fdfcac-b095-487d-aed1-7c0cc19ef5e1` removes the five-invitations-per-day member cap and its form/error copy. Seven-day expiry, membership eligibility, duplicate-send protection, and shared email-delivery budgets remain enforced. The deployed build includes the preceding performance, focused-post, comment-like, photo-editing, direct-joining, and design-audit work. Production migration history already contained 0001–0017; no migrations were applied during this release.

The code passed formatting, lint, types, all 232 tests, and the production build before release. A fresh encrypted production backup passed quarantined local restoration, SQL integrity, and all three stored-image checksum checks. The production storage counter matched its ledger. Cloudflare confirms this version receives 100% of traffic.

Nineteen direct HTTP checks verified matching HTML/JS/CSS/manifest, available sign-in and signed-out bootstrap, anonymous API/media rejection, cross-origin mutation rejection, malformed invitation-credential rejection, private response headers, and HTTPS redirection. The six-concurrent-invitations regression ran against isolated Worker/D1 with a simulated email provider; no real invitation was sent for release verification. No browser or visual tests were performed. Full hosted signed-in multi-user verification remains open, and the new backup still needs manual off-device copying.

## Own posts feed release (October 11, 2026)

Worker version `30a558f0-3958-463b-bf26-4b8cec8e792b` includes each member’s own published posts alongside accepted follows in the chronological home feed. Own posts use the existing snapshot pagination and indexed author selection; no self-follow records or database migrations are needed. Profile lists and private-resource authorization keep their existing behavior.

Formatting, lint, types, all 233 tests, and the production build passed. Worker/D1 regressions cover own posts with no accepted follows, mixed authors and tied timestamps, pagination across inserts/deletions, draft/failed-upload exclusion, revoked access, and bounded reads with 20,000 unrelated posts. A fresh encrypted production backup passed SQL integrity and three image checksum checks. Cloudflare confirms 100% traffic on this version; 12 direct HTTP checks verified matching HTML/JS/CSS/manifest, sign-in availability, private signed-out responses, invalid-session rejection, and foreign-origin rejection. The signed-in feed behavior was verified in isolated integration tests; no browser/visual tests or production test posts were used.

## Confirmation and startup recovery release (October 11, 2026)

Worker version `8c2c8135-266a-4995-bb27-05e59821ac1a` adds confirmation before profile unfollow/block actions and comment deletion, uses an accessible trash icon for comment deletion, and places own-profile Invite/Settings beside the avatar/name group with both groups top aligned. Startup requests now have a 15-second deadline with retry and stale-response protection. No schema or infrastructure configuration changes were required. The intermittent desktop/mobile startup incident remains under investigation; this recovery behavior does not establish its cause.

Formatting, lint, types, all 238 tests, boundary checks, and the production build passed. Node component regressions cover cancellation without mutations, busy-state duplicate prevention, failure/retry, correct deletion targets, and startup timeout/unmount/late-response behavior. A fresh encrypted production backup passed quarantined local restoration, SQL integrity, and all 12 image checksum checks. Twelve direct production HTTP checks verified matching HTML/JS/CSS/manifest, available sign-in and signed-out bootstrap, private response headers, anonymous API/media rejection, and foreign-origin mutation rejection. No browser or visual testing was performed, and no affected signed-in desktop request was captured.

## Activity simplification release (October 11, 2026)

Worker version `1d38ca71-6e93-4138-834e-d4a5ba7bb663` removes the Activity mark-as-read control, unread labels, read-marker query joins, and acknowledgement endpoint. Follow requests, grouped likes, and comments remain one newest-first timeline with inline Accept/Deny and Newer/Older pagination. Viewing activity does not dismiss its events. Historical read markers remain in the database and are still covered by account deletion; no schema migration or production data modification was required.

Formatting, lint, types, boundary checks, all 238 tests, and the production build passed. Local checks cover mixed-event pagination with timestamp ties, repeatable page reads, ignored historical markers, no acknowledgement writes, follow decisions, and existing source visibility/revocation. Eight direct HTTP checks verified matching deployed HTML/JS/CSS/manifest, available sign-in and signed-out bootstrap, private responses, anonymous Activity rejection, and cross-origin rejection. Signed-in behavior was verified against isolated Workers/D1; no browser or visual tests were performed.

## Profile, portrait, and Activity release (October 12, 2026)

Worker version `f33a2d8e-f245-4409-b36e-587440c3a763` moves profile Unfollow into the overflow menu above Block account while retaining confirmation. Feed, focused-post, and upload-preview photos now fill their container width until their height reaches twice that width; exceptionally tall photos scale down without cropping. Like/comment Activity rows are full native post links with a private 64px thumbnail on the left, replacing the separate View post link. Request decisions remain independent controls. No notification delivery, push subscription, or email activity feature was added.

Formatting, lint, types, boundary checks, all 238 tests, and the production build passed. Existing component regressions now exercise menu-only unfollowing, confirmation cancellation/failure/retry, native Activity row links and thumbnail URLs, independent follow decisions, and return pagination. Existing Worker/D1 media checks verify private thumbnails, legacy fallback, and revocation. Nine direct HTTP checks verified matching deployed HTML/JS/CSS/manifest, available sign-in and signed-out bootstrap, private responses, anonymous Activity/thumbnail rejection, and cross-origin mutation rejection. This release changes only frontend behavior and requires no schema migration. No browser or visual tests were performed.

## Unified activity migration (October 12, 2026)

Apply `0018_activity_read_state.sql` before deploying unified automatic read tracking. Take and restore-check a fresh encrypted production backup first. The migration backfills per-source receipt versions and imports legacy read watermarks; previous Worker writes remain compatible through transactional triggers. It requires no new service, secrets, or paid infrastructure. Deploy after the full local gate passes. Web Push remains unimplemented.

## Unified activity release (October 12, 2026)

Worker version `72dcf542-db12-415e-a0f9-2ea530766f35` serves 100% of production traffic. Requests, grouped likes, and comments remain one chronological timeline with one numbered unread badge. An unread summary becomes read after at least half of it is visible for 250 continuous milliseconds, excluding hidden tabs and mobile navigation. Seen requests remain actionable without retaining an unread count. Read acknowledgements are batched, versioned, retried on failure, and independent of request acceptance. Badge polling runs only while visible and never reloads the feed. No Web Push delivery or email activity notification was added.

Formatting, lint, types, boundary checks, all 247 tests, and the production build passed. Node component/observer checks cover dwell timing, offscreen/hidden resets, cleanup, batching/retries, polling, badge failures, and retained request actions. Worker/D1 tests cover current permissions, duplicate/stale acknowledgements, tied timestamps, recreated requests, cascaded cleanup, migration backfill, and atomic rollback. Local 30/3,000-post fixtures both used 286 rows read for a 20-item page, 360 for its acknowledgements, and 5 for a badge query with one unread item after read history.

The encrypted backup taken at `2026-10-12T07:39:01.593Z` passed SQL integrity, quarantine, and checksum verification for 14 images before explicit application of migration 0018. Post-migration read-only checks found 10 sources, 10 receipts, no missing receipts, and no foreign-key violations. Eleven direct production HTTP checks verified matching HTML/JS/CSS/manifest, sign-in availability and signed-out bootstrap, private/no-store responses, anonymous list/count/read rejection, private thumbnail rejection, and foreign-origin mutation rejection. Signed-in behavior was tested only in isolated Workers/D1; no browser or visual testing was performed.

## Web Push setup

Apply migration `0019_web_push.sql` after a verified encrypted backup and before deploying the push code. The preceding Worker remains schema-compatible; subscriptions are empty until explicit opt-in, so rollout sends no historical activity. Stable P-256 VAPID keys are required in both `PUSH_PUBLIC_KEY` and `PUSH_PRIVATE_KEY` Worker secrets. Generate them once outside the repository, keep a private recovery copy, and never rotate them incidentally during deployment:

```sh
node scripts/ops/push-keys.mjs /private/path/push-vapid.json
npx wrangler secret bulk /private/path/push-vapid.json --env production
```

The script refuses to overwrite an existing file. For local experiments use separate test keys in `.dev.vars`; production keys must never be used in CI. The public half is intentionally exposed to authenticated browser subscribers; the private half never enters the client. The application origin identifies the VAPID sender. No additional provider account or paid service is needed. Losing/rotating this pair requires removing existing subscriptions and having members opt in again; the encrypted D1 backup does not contain the VAPID private key.

The existing Worker uses an hourly delivery cron alongside quarter-hour maintenance. Deploy only after the full repository gate passes. Settings remains off by default, with explicit enable/disable per signed-in device. iOS/iPadOS requires a Home Screen web app and a user-initiated permission request ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Permission or OS settings may prevent delivery; local tests cannot prove device receipt. See the push README for hourly fallback delays and backlog limits.

## Web Push release — October 12, 2026

Worker `6da41271-6869-4ff5-9866-cd2497eefa76` receives 100% of production traffic as of `2026-10-12T08:20:25.171Z`. Migration 0019 and both stable VAPID secrets are configured. Settings offers explicit per-device enable/disable for requests, comments, and grouped likes. Push and Activity use the same logical keys and versions; receiving an alert does not mark it read. No member was automatically subscribed. Both production delivery tables were empty after deployment.

Formatting, lint, types, boundary checks, all 274 tests, the production frontend build, and the Worker dry-run bundle passed. Real local Workers/D1 tests encrypted and independently decrypted payloads, verified VAPID signatures, and exercised opt-in, current authorization, concurrent claims, coalescing, Retry-After, lease recovery, expired subscriptions, atomic rollback, library sign-out, and removal/read cancellation. Node component and service-worker VM tests covered permission gestures, browser failure states, stale responses, safe destinations, and generic alert content.

The encrypted backup captured at `2026-10-12T08:18:14.741Z` passed quarantined local restoration, SQL integrity, and all 14 image checksum checks before migration. Fifteen direct production HTTP checks confirmed matching HTML/JS/CSS/manifest/service-worker assets, service-worker cache policy, available sign-in/bootstrap, signed-out rejection for push/list/count/read routes, private media rejection, and foreign-origin rejection. Read-only production checks found no foreign-key violations or missing activity receipts.

Actual device permission and OS receipt remain unverified; no browser or visual tests were performed. Users must opt in on each device. The fresh backup and separate private VAPID key file still require manual off-device copying under the operations policy.

## Startup recovery release — October 12, 2026

Worker `83276013-befe-46aa-8afa-69d1db25e09a` receives 100% of production traffic as of `2026-10-12T17:47:26.565Z`. This release removes Better Auth's dynamic async-hooks import in the Workers bundle, limits reuse to initialized instances, and bounds library operations with retryable 503 errors. Client GET requests and pre-bundle startup now offer recovery from stalled loading. No migration, plan change, or persistent log collection was introduced. The production incident was not reproduced; see the [investigation record](operations.md#startup-stall-follow-up-october-12-2026) for evidence and limitations.

Deployment used an isolated release copy of the preceding production source plus these loading/auth changes. Concurrent, separate profile-connection work in the shared workspace was excluded and left intact. The isolated copy passed formatting, lint, types, boundary checks, all 286 tests, and the frontend build. The actual Wrangler production dry-run bundle contained static async-hooks imports and no dynamic async-hooks import. Tests covered cancelled concurrent startup reads for four synthetic members, auth deadlines/cache recovery/HTTP status, late response suppression, independent startup-script recovery, and database-wait diagnostics. Real D1/Worker reads also completed while the image-provider boundary was deliberately paused. These local tests do not prove the intermittent provider failure was reproduced. No browser or visual testing was performed.

The encrypted production backup captured at `2026-10-12T17:46:08.214Z` passed quarantined local restoration, SQL integrity, and checksums for all 16 images. Seventeen direct production HTTP checks verified matching HTML/JS/CSS/manifest/push-worker/startup-script bytes, recovery-script revalidation, available bootstrap/auth/status, the new database-wait timing header, and unchanged anonymous/foreign-origin/private-media boundaries. Signed-in concurrency was tested only with isolated synthetic data. The new backup still needs manual off-device copying under the existing operations policy.

## Profile connections release — October 12, 2026

Worker `64ae2674-5fb6-411e-a7c0-9d5264ebd7fd` receives 100% of production traffic as of `2026-10-12T18:04:19.832Z`. Profiles you follow have Posts, Following, and Followers tabs with explicit pagination and profile links. Connection lists require ownership or a current accepted follow, exclude hidden accounts before pagination, and recheck access on each read. Pending requests and blocked-account lists remain owner-only. The preceding startup recovery release remains included; no schema or infrastructure change was required.

Formatting, lint, types, boundary checks, all 296 tests, and the production build passed before deployment. The encrypted backup captured at `2026-10-12T18:03:49.023Z` passed quarantined local restoration, SQL integrity, and checksums for all 16 images. Wrangler confirmed no pending migrations.

All 23 direct production HTTP checks passed, including matching HTML/JS/CSS/manifest/service-worker/startup-script bytes, available sign-in/bootstrap, private response headers, anonymous and invalid-session connection rejection, foreign-origin rejection, and inaccessible media. Accepted-follower behavior, revocation, filtering, pagination, and tab navigation were verified with isolated Worker/D1 and Node component tests. No browser, visual, or signed-in production testing was performed. The new backup still needs manual off-device copying under the operations policy.

## Follower activity and auth recovery release — October 12, 2026

Worker `9b60b1dd-fcc6-4150-a2b4-2ba7f038f01d` receives 100% of production traffic as of `2026-10-12T18:28:30.071Z`. New-follower Activity and opt-in push now follow acceptance or invitation photo completion. Existing active clients should reload to receive the new event renderer. Historical accepted follows are not backfilled.

The encrypted backup captured at `2026-10-12T18:25:52.071Z` passed quarantined local restoration, SQL integrity, and all 16 image checksum checks. The matching Worker/assets were deployed in maintenance mode, and four direct API/media probes confirmed the gate before allowing in-flight requests to drain. Migration 0020 and its migration-history record were imported together through the atomic file endpoint. Before reopening, aggregate checks confirmed preservation of all eight sources and receipts, their timestamp/version/read-state totals, the revision high-water mark, the one registered device, and the empty delivery queue. All eight expected follow/receipt/enqueue triggers were present; there were no foreign-key violations, missing receipts, or pending migrations. After migration, rollback code must understand follower events or remain in maintenance; do not reopen the preceding renderer against the expanded activity types.

The auth mitigation in this release has no database migration dependency. CI explicitly invokes Better Auth's schema validation against isolated migrated D1, including a failing schema-drift control. Production request handling skips only runtime schema introspection; authentication and authorization still use the library and current database state. See [the investigation](operations.md#android-push-opt-in-investigation-october-12-2026) for evidence and limits.

Local verification passed formatting, lint, types, all 317 tests, the frontend build, and the production Worker dry-run bundle. Tests cover follower acknowledgement/visibility/pagination, invitation completion, encrypted push and revocation, exact migration preservation and rollback, the schema-verdict stall, and delayed permission/retry behavior.

All 23 direct production HTTP checks passed after reopening, including matching HTML/JS/CSS/manifest/service-worker/startup-script bytes, available sign-in/bootstrap, private response headers, anonymous and invalid-session rejection, foreign-origin rejection, and inaccessible media. The production subscription was preserved without sending synthetic activity to it. No browser, visual, signed-in production, or real-device OS delivery tests were performed. The original Android timeout cause remains unconfirmed. The new encrypted backup still needs manual off-device copying under the operations policy.

## Focused photo viewer release — October 12, 2026

Worker `566e2eaf-3821-4318-ae85-9487adebdb3d` receives 100% of production traffic as of `2026-10-12T18:47:30.623Z`. At desktop widths, tapping or clicking the focused post photo opens the shared image-only viewer; there is no separate visible enlarge control. Full-width mobile photos remain plain images. The viewer closes when narrowing the screen or leaving the post, and retains private media access, alt text, retry, and native dialog behavior. This release also removes the post heart's leading visual indent. Usernames already enforce the confirmed three-character minimum; no username rule changed. Comment tagging is recorded only in the feature wishlist.

Formatting, lint, types, all 319 tests, and the production build passed before deployment. The encrypted backup captured at `2026-10-12T18:46:54.110Z` passed quarantined restoration, SQL integrity, and checksums for all 16 images. The initial D1 preflight/export failed with a provider authorization response; sequential retries succeeded before deployment. No migrations were pending, and no maintenance window or infrastructure change was needed.

All 23 direct production HTTP checks passed: deployed HTML/JS/CSS/manifest/service-worker/startup-script bytes matched the tested build, sign-in/bootstrap were available, and private API/media and foreign-origin boundaries remained enforced. Responsive interaction and existing profile-viewer behavior were verified through Node component tests and static CSS review, without browser or visual testing. The fresh encrypted backup still needs manual off-device copying under the operations policy.

Startup recovery diagnostics require migration `0021_startup_diagnostics.sql` before application deployment. Production migration 0021 was applied on October 12, 2026.

## Automatic startup recovery release — October 12, 2026

Worker `36244b8a-6a03-4634-819c-13339ce60d3e` receives 100% of production traffic as of `2026-10-12T19:23:09.047Z`. Initial bootstrap GETs retry transient failures once after 500 ms, within a 20-second overall deadline. Persistent failures retain Try again. Mutation requests are not automatically replayed. Abnormal startups retain capped anonymous diagnostics in the existing D1 database; general provider request logging remains disabled. This improves recovery and investigation without establishing the original intermittent failure's cause.

The encrypted backup captured at `2026-10-12T19:21:15.090Z` passed quarantined restoration, SQL integrity, and checksums for all 16 images. Migration 0021 was applied before deployment and adds only the diagnostic table and expiry index. Read-only production checks found the table initially empty, no foreign-key violations, and no pending migrations. Existing quarter-hour maintenance runs retention cleanup; actual production expiry execution has not yet been observed. Local D1 tests verify expiry and the atomic 200-record cap.

Formatting, lint, types, boundary checks, all 326 tests, the production frontend build, and Worker deployment passed. The first deployment's oversized-report probe exposed a 500 instead of 413; an explicit body-limit response and regression test corrected it before final verification. All 28 final direct production HTTP checks passed, including matching assets, available sign-in/bootstrap, private API/media boundaries, and diagnostic GET/origin/schema/body-size rejection. No synthetic failure reports were stored in production. Signed-in behavior and successful diagnostic retention were verified with isolated tests; no browser or visual testing was performed. The new encrypted backup still needs manual off-device copying under the existing operations policy.

## Lowercase branding and compact startup release — October 12, 2026

Worker `26c8374b-4abf-464f-9e04-cf3168a0934b` receives 100% of production traffic as of `2026-10-12T19:39:30.987Z`. The app name is lowercase `slowmass` in browser and installed-app titles, interface and accessible text, notifications, and email sender/copy. The existing favicon geometry and colors remain unchanged; only its accessible title changed. Startup, startup error/unavailability, and invitation-loading headers now use a 26px wordmark at all viewport sizes, with the existing 48px touch target. This addresses the full in-app wordmark, not the separate OS-generated icon splash screen.

Formatting, lint, types, boundary checks, all 326 tests, and the production build passed. The encrypted backup captured at `2026-10-12T19:36:46.262Z` passed quarantined restoration, SQL integrity, and all 16 image checksum checks. No migrations were pending or required.

All 31 final direct HTTP checks passed, covering matching HTML/JS/CSS/manifest/service-worker/startup-script/favicon bytes, lowercase titles, available sign-in/bootstrap, private-resource boundaries, and diagnostic safeguards. Initial post-deployment CSS byte comparisons failed; subsequent direct reads and the complete rerun matched the tested build. Static checks confirmed the compact startup selector overrides viewport wordmark sizes and preserves the link target. No browser, visual, or real-device tests were performed. Existing installed apps may retain platform-managed metadata until refreshed by the platform; this release does not claim immediate OS launcher-name refresh. The encrypted backup still needs manual off-device copying under the existing operations policy.

## Shared invite links and invitee Activity release (October 12, 2026)

This implementation requires migrations 0022 and 0023. Do not deploy it against the preceding schema. Take and quarantine-restore-check a fresh encrypted backup first. Migration 0022 adds shared links and claims, retains one invitation per redemption, and limits the existing mutual-follow trigger to personal email invitations. Migration 0023 rebuilds the Activity source kind constraint while preserving exact receipts, versions and pending delivery state; run it as one atomic D1 batch/file migration, never separate request-time statements. Verify source/receipt/outbox aggregates, sequence high-water marks, foreign keys and migration history before serving the new Worker. Use the established maintenance deployment sequence while rebuilding the source table. No new service, secrets, paid plan or automatic deployment is required.

New clients opt into joined Activity in list/count requests; existing open clients remain compatible. Rollback must retain both schema migrations and a Worker that excludes shared redemptions from generic personal invitation eligibility, understands their lack of automatic follows, and maintains the expanded Activity constraint. Do not restore the old database over members who have joined since rollout. Restore quarantine now removes shared verification claims and revokes all restored shared links before any membership is re-enabled.

After deployment, verify the private link-management boundaries, public preview rejection, matching `/invite` assets with private/no-store/no-referrer headers, and new-client Activity capability through direct HTTP/API checks. Successful end-to-end sign-up tests use synthetic isolated D1/email fixtures, not production accounts or real outbound invitations.

Local shared-invitation verification passed formatting, lint, types, dependency boundaries, all 344 tests, the frontend production build, and the production Worker dry-run bundle. Coverage includes real library email verification, identity/session issuance, concurrent last-place consumption, pinned attribution without fallback, profile completion notifications, owner isolation, link pagination, deletion/restore cleanup, and atomic migration rollback/preservation. Production migrations and deployment completed as recorded below.

Worker `c47e6ec6-f9c6-46f9-970e-dde9ba123a21` reached 100% at `2026-10-12T20:24:57.570Z`. The encrypted backup captured at `2026-10-12T20:23:02.783Z` passed quarantined restoration, SQL integrity, and all 16 image checksum checks. The initial export failed; a retry completed before any production changes. Four direct probes verified maintenance mode, followed by an in-flight request drain. Both migrations and their history entries were applied together through the atomic D1 file-import endpoint. Before reopening, eight aggregate comparisons confirmed preservation of all eight Activity sources and receipts, timestamps, read/version totals, revision high-water mark, the empty push queue, one registered device, membership and invitation counts. No foreign-key violations or pending migrations remained.

All 43 final direct HTTP checks passed: matching frontend assets and compact startup, sign-in/bootstrap availability, private API/media boundaries, diagnostic safeguards, shared-link management authorization/origin checks, malformed and unavailable public preview handling, and `/invite` asset/cache/referrer headers. The initial invite probe expected a single referrer policy; Cloudflare combines the global and route policies, ending with the effective `no-referrer` value. The corrected probe passed without an application change. Real email verification and new-member Activity were tested with isolated synthetic fixtures; no production accounts, outbound invitations, browser, visual, or device tests were used. The encrypted backup still requires manual off-device copying under the existing operations policy.

## Fixed invite links release (October 12, 2026)

Migration 0024 permanently removes private link names and sets existing capacities to 100 without changing timestamps, credentials, usage counts or invitation provenance. The updated API accepts only a creation operation ID; stale clients submitting removed fields receive reload guidance. History identifies links by creation date/time.

Take and verify an encrypted backup, deploy the checked Worker in maintenance mode, drain requests, and atomically import 0024 with its migration-history entry before reopening the new Worker. The old Worker’s list and account-cleanup queries require the removed column, so do not run it against the new schema or roll back to it. Verify preserved link counts/uses/timestamps, fixed capacities, foreign keys, and migration history. Previously exhausted links whose credentials were already cleared remain uncopyable; create a fresh link in that case. Production rollout is recorded below.

Worker `b773910d-ad4b-4f97-8faa-be8faac0c6cb` reached 100% at `2026-10-12T20:55:18.181Z`. All 346 tests, formatting, lint, type/boundary checks and the production build passed. The encrypted backup captured at `2026-10-12T20:53:31.053Z` passed quarantined restoration, SQL integrity and all 16 image checksum checks. Four API/media probes confirmed maintenance before draining in-flight requests and atomically importing 0024 with its history entry. There were no existing shared links or claims; all six memberships and ten invitation records remained intact. Aggregate comparisons matched, the name column was absent, fixed-capacity/immutable triggers were present, and there were no foreign-key violations or pending migrations.

All 43 final direct HTTP checks passed, including matching deployed assets, available bootstrap/sign-in, private APIs/media, diagnostic guards, and shared-invitation boundaries. The first two check runs encountered a 503 on different endpoints immediately after release; subsequent focused probes and the entire final run passed. The failed responses were not captured, so their cause is unconfirmed. No browser/visual/device testing or production sign-up mutations were performed; successful creation and capacity enforcement were verified in isolated D1 tests. Membership remains invite-only. The backup still requires manual off-device copying under the existing operations policy.

## Onboarding recovery audit and copy release (October 12, 2026)

Worker `6213361c-8383-4c59-af90-f4cd1fb0b003` reached 100% at `2026-10-12T21:11:38.537Z`. Generic onboarding no longer promises automatic mutual follows, which apply only to personal email invitations. No onboarding state transitions or membership rules changed. New isolated tests verify recovery for both invitation types before profile creation and after identity is saved without an avatar, including session loss, ordinary email reauthentication, a revoked shared link, an inactive inviter, preserved attribution/capacity, API completion gates, and deep links remaining in onboarding.

All 350 tests, formatting, lint, types, boundary checks and the production build passed. No migrations were pending. The encrypted backup captured at `2026-10-12T21:11:06.221Z` passed quarantined restore, SQL integrity and all 16 image checksums. The first post-deploy probes saw a missing new bundle served as SPA HTML and an older HTML version; after allowing propagation to settle, all 43 direct HTTP checks passed with exact current asset bytes and healthy sign-in/private API boundaries. No browser, visual, real-device or production sign-up tests were performed. Manual off-device backup copying remains outstanding under the existing policy.

## Current invite link release (October 12, 2026)

Worker `dbce0dd5-ce10-4508-bab0-a7f879a7b98e` reached 100% at `2026-10-12T23:05:14.510Z`. One current shared link per inviter replaces link history and capacity management. Copy reuses a valid credential without extending its seven-day expiry and creates a fresh link after expiry. Replace link lives in the three-dot menu with confirmation. Successful joins retain immutable inviter attribution and invitation type; shared links have no sign-up cap or automatic follows.

The Node 24 gate passed formatting, lint, types, boundaries, all 366 tests, and the production frontend build. The encrypted cutover backup captured at `2026-10-12T22:59:48.334Z` passed quarantined restoration, SQL integrity, and all 16 image checksum checks. Four API/media probes confirmed maintenance before requests drained and migration 0025/history were imported atomically. Production had three unused shared links, no shared redemptions or claims, six memberships, and ten personal invitation records. The migration cleared those unused credentials and preserved account/content/relationship tables, Activity/receipts, and revision sequences. SQL integrity and foreign-key checks passed. Existing diagnostic records survived; maintenance-response telemetry added six diagnostics during the comparison window. No user content or invitation provenance changed.

All 52 final direct HTTP checks passed with matching deployed HTML/JS/CSS/manifest/service-worker/startup assets, healthy sign-in/bootstrap, current-link authentication/origin checks, removed legacy endpoints, invalid invitation rejection, and private API/media/diagnostic safeguards. No browser, visual, real-device, production invitation creation, or sign-up tests ran; signed-in flows and races passed isolated Worker/D1 tests. The initial D1 management reads returned authorization/internal errors; a subsequent read succeeded before the cutover. The maintenance Worker was `d23df236-caeb-43ec-8da6-46083ccb90cb`; maintenance is disabled in the final release.

Routine code-only deployments no longer require a fresh backup, per the owner’s instruction. The operations runbook retains the manual cadence and backups before migrations or recovery. Off-device copying of new backups remains manual.

## Hourly Web Push fallback — October 12, 2026

Worker `e6fba1ab-48cd-4c2a-81d9-b89127146d57` receives 100% of production traffic as of `2026-10-12T23:36:42.695Z`. The delivery cron now runs at the top of each hour; quarter-hour maintenance and immediate mutation dispatch remain enabled. Unrecognized scheduled events are ignored during propagation. Like-group eligibility still waits ten seconds, so idle delivery can wait for the next hourly pass or longer when more than five deliveries are queued. The Activity identity, version, grouping, read-state, and authorization rules are unchanged.

Formatting, lint, types, boundaries, all 367 tests, production frontend build, and the Worker dry-run bundle passed. A Worker/D1 regression verifies hourly dispatch, quarter-hour session cleanup without push delivery, and ignored obsolete triggers. Read-only provider inspection confirms both live cron expressions, the exact checked Worker bytes, and the deployment percentage. Twelve final direct HTTP checks passed for matching HTML/JS/CSS, sign-in/bootstrap availability, signed-out private API/media rejection, private/no-store headers, and foreign-origin rejection. No migration or new hosted service was required; frontend asset bytes matched the preceding release. Actual hourly cron execution and OS delivery were not observed. No browser, visual, or production notification mutations were performed.

## Request round-trip reduction — October 12, 2026

Worker `d6a9dde1-cdff-4966-ba05-2e27e36be1dd` was deployed at `2026-10-13T02:08:00Z` (October 12 Pacific time), receiving 100% of traffic. It enables native auth joins, combines membership/completion reads, returns post-like counts directly, starts profile Posts requests alongside metadata, and adds R2 lookup timing. Washington placement and both scheduled triggers remain configured. No migration, paid service, or private cache was introduced.

All 371 tests, formatting, lint, types, boundaries, the frontend build and Worker dry-run passed. Reconstructing the pre-change Worker matched the previous production bundle after normalizing dependency source-path labels; the new deployed Worker matches its checked bundle exactly. Twelve direct HTTP/asset checks verified bootstrap/status, signed-out API/media rejection, no-store responses, foreign-origin rejection, and exact HTML/JS/CSS. Responses report Seattle placement and the additional R2 timing field. Local tests cover joined authentication, fresh membership/completion/expiry, duplicate like/unlike counts, parallel profile reads with authorization gating/cancellation, client error recovery, and R2 timing without consuming streams. Hosted signed-in latency measurements remain separate evidence in operations.md.

## Pill comment composer release (October 12, 2026)

Worker `4f4bf43f-ae1b-4993-9d21-2b4fc6bb356d` reached 100% at `2026-10-13T02:16:34.167Z`. Feed and focused-post comments use the shared pill composer with a green circular send action, growing multiline input, and balanced divider spacing. Formatting, lint, types, boundaries, all 371 tests, and the production build passed. Twelve direct HTTP checks verified exact HTML/JS/CSS bytes, available sign-in, signed-out bootstrap, and private API/media/origin boundaries. No migrations or browser/visual tests were needed.

The metadata follow-up deployed as Worker `39e60c73-a812-403a-8323-e16a571535dc`: a 16px trash icon, shared compact line height, and equal visible gaps between timestamp, like count and delete icon, preserving the 44px touch target. The full 371-test gate and production build passed again, followed by all 12 direct HTTP asset/API checks. No browser or visual testing was performed.

A further owner-requested metadata refinement deployed as Worker `c4fa15a5-de90-408a-8527-8b194478721b`: reduce the trash icon to 14px, lift it 2px for optical text alignment, and widen item gaps to 16px. All 371 tests, formatting, lint, types, boundaries, and build passed. Direct HTTP verified exact HTML/JS/CSS bytes, sign-in availability, and private signed-out comment rejection. No browser or visual testing.

## Compact composer refinement (October 12, 2026)

Worker `e3d439aa-07c3-423a-8ec5-cb7ac489ebb6` deploys a 44px initial composer height, 22px left text inset, and matching 15px input/caption type. The send circle is flush with the outer edges and remains opaque when disabled to cover the outline; the smaller plane icon has an optical centering adjustment. Text-field focus darkens the single inset outline without an outer ring. Multiline growth and the 44px send target remain. All 371 tests and repository gates passed; five direct HTTP checks verified exact HTML/JS/CSS, sign-in availability and private signed-out comment rejection. No migration, browser or visual testing.

## Comment stack spacing (October 12, 2026)

Worker `22cf3368-b681-47e2-92b6-7114e69b2f3c` removes comment metadata minimum-height rules and inherited generic delete-button sizing. Natural text lines and padded controls preserve 44px touch targets. Comments use only 16px bottom padding, with no default list margins or shared generic list borders/padding. All 371 tests and repository gates passed. Five direct HTTP checks confirmed exact HTML/JS/CSS, available sign-in and signed-out private comment rejection. No migrations, browser or visual testing.

Worker `6149b78f-3e87-47cf-a7a5-f62c85ae26ad` refines the comment stack to consistent 12px gaps after the post icons, between comments, and before the composer. All 371 tests, formatting, lint, types, boundaries and build passed. Five direct HTTP checks verified exact HTML/JS/CSS, available sign-in and signed-out private comment rejection. No browser or visual testing.

## Follow-back Activity release — October 13, 2026

Apply additive migration 0026 before deploying the follow-back UI/API. It adds a default-undismissed flag to existing Activity receipts, preserving source identities, read versions and queued pushes. Follow the existing migration backup workflow. The preceding application remains compatible with the added column; code rollback does not require removing it. Migration 0026 is applied in production; persistent local migration remains separate.

Worker `63400a03-dbbf-4ca0-ab27-d79040de83d9` reached 100% at `2026-10-14T00:16:19.204Z` (October 13 Pacific). Follow-request and follower rows now include private avatars and vertically centered right-side actions, with primary green Accept/Follow back buttons. Follow back is offered only without an outgoing pending/accepted follow and supports cross-device dismissal. The Activity unread badge is Douglas Fir green with white text.

The final Node 24 gate passed formatting, lint, types, boundaries, all 376 tests, and the frontend production build; Worker dry-run packaging also passed. The encrypted pre-migration snapshot captured at `2026-10-14T00:14:15.676Z` passed quarantined restoration, SQL integrity and all 28 stored-image checksum checks. The additive migration used the normal migration command without a maintenance deployment. Before/after aggregates preserved nine memberships, 31 Activity sources/receipts, revision/read totals and empty push/device tables; all receipts defaulted to undismissed, with no foreign-key violations or pending migrations. The hosted integrity-check pragma was rejected; integrity was verified on the quarantined backup instead.

Thirteen final HTTP checks passed for exact deployed HTML/JS/CSS, bootstrap/status availability, private API/media boundaries and dismissal authentication/origin protection. No browser, visual or production signed-in mutation tests were performed. Signed-in follow-back, dismissal and retries were verified in isolated fixtures. Manual off-device backup copying remains outstanding under the operations policy.

## Mobile profile tab spacing release (October 13, 2026)

Worker `2c9d9137-8e19-43b4-9578-f836e18f3bd5` receives 100% of production traffic. Mobile profile tabs use the identity header's 16px side inset on own and accepted-follow profiles; the photo grid stays edge to edge. The CSS rule now matches through the profile loading/authorization wrapper. Desktop styling is unchanged.

Formatting, lint, types, boundaries, all 401 tests, and the production build passed. Ten direct HTTP checks confirmed exact HTML/JS/CSS bytes, available sign-in/bootstrap, signed-out API/media rejection, private/no-store responses, and foreign-origin rejection. No migrations, browser tests, or visual tests were performed.

## Optional device setup release (October 13, 2026)

Migration 0027 requires a short maintenance window: the old Worker writes subscriptions using a uniqueness constraint that the migration removes. Prepare and check the new build first; take and verify the usual encrypted backup. Enable maintenance with the existing deployment workflow, apply 0027 explicitly, deploy the matching Worker/assets, then verify schema/foreign keys and unchanged subscription and queue counts while maintenance remains enabled. Disable maintenance with that same version, then verify signed-out rejection and bootstrap responses through direct HTTP checks. Re-enable maintenance if those checks fail. Do not run the previous Worker against the migrated schema outside maintenance or restore an old database over live writes. If interrupted, remain in maintenance and finish the matching deployment. An older queued delivery lease is preserved and can expire/retry normally.

Migration is tested for preservation and transactional rollback in isolated D1. Existing accounts are not enrolled into optional onboarding; future membership creates pending setup. Existing endpoints and queued notifications survive. Older open clients must reload before changing notification settings because the former session-only API cannot distinguish copied-session installations; delivery and logout revocation remain effective. Production migration is complete. Real-device installation handoff and OS-level delivery remain unverified for this change.

Worker `fc9b9954-e5fa-47d1-9bab-bfc8fc83b6d9` reached 100% of traffic at `2026-10-14T01:07:07.027Z`. The Node 24 gate passed formatting, lint, types, boundaries, all 401 tests, and the production frontend build; Worker dry-run packaging also passed. The encrypted backup captured at `2026-10-14T01:04:23.337Z` passed quarantined restoration, SQL integrity, foreign keys, and all 28 image checksum checks.

The matching Worker was first deployed in maintenance as `fa67bcaf-57aa-45fa-a9c2-2104be58b83a`. Five API/media probes confirmed maintenance and in-flight requests drained before migration 0027 and its history entry were imported atomically. All 13 recorded aggregates matched afterward, including nine memberships, 32 Activity sources/receipts, revision/read totals, and empty subscription/delivery tables. Existing members have no pending setup rows; all six relevant triggers and the non-unique session index are present. Temporary migration tables are gone, foreign keys are clear, and no migrations remain pending.

After reopening, all 28 direct HTTP checks passed: exact deployed HTML/JS/CSS/service-worker/manifest/startup bytes, sign-in availability, signed-out and invalid-session bootstrap, private API/media rejection, and authentication/origin enforcement for setup and endpoint-specific push mutations. No browser, visual, real-device or production signed-in mutation tests ran. A private recovery ZIP was prepared locally for the owner; off-device copying remains manual under the operations policy.

## Consistent Activity images release (October 13, 2026)

Worker `ee288a0e-0cb9-42a5-acdd-eb38658a4a2a` reached 100% at `2026-10-14T01:12:14.452Z`. All Activity images now share a fixed 64px square footprint; profile avatars remain circular and post thumbnails square. The Node 24 gate passed formatting, lint, types, boundaries, all 401 tests, and the production build. All 28 production HTTP checks passed, including exact deployed HTML/JS/CSS/service-worker/manifest/startup assets, sign-in/bootstrap availability, and private-resource authentication/origin boundaries. This code-only release required no migration, maintenance window or new backup under the existing cadence. No browser or visual testing was performed.

## Touch cropping and mutation refresh release (October 13, 2026)

Worker `cfc9f073-d7e2-4c6d-b96f-b6f9b0f81963` reached 100% at `2026-10-14T01:35:19.774Z`. The release adds profile-photo pinch zoom/repositioning, join-form spacing, and optional device-setup cleanup. Follow requests and other audited mutations retain unaffected images during server revalidation; feed updates preserve expanded comments and drafts. Confirmed deletions disappear immediately, while failed revalidation clears retained content.

The Node 24 gate passed formatting, lint, types, boundaries, all 413 tests, and the production build; Worker dry-run packaging also passed. Production had no pending migrations. All 36 direct HTTP checks passed: exact HTML/JS/CSS/service-worker/manifest/startup bytes, invitation-page assets and privacy headers, sign-in/bootstrap availability, invalid-session handling, private API/media rejection, and origin enforcement for follow, setup, and push mutations. This code-only release required no migration, maintenance window, or new backup under the existing cadence. No browser, visual, real-device gesture, or production signed-in mutation tests ran; device behavior and network byte savings remain unmeasured.

## Auth isolation and redundant reads release (October 13, 2026)

Worker `03674e2e-1f0f-439c-a0c3-f7cb43ca449b` reached 100% at `2026-10-14T01:55:51.431Z`. Auth instances and measured database wrappers now belong to one request, removing reuse of lazy library state after its originating request ends. Safe session dispatch, endpoint-entry, and lookup markers narrow future timeouts. Signing secrets, cookies, persisted sessions, expiry, and membership checks are unchanged. This targets the captured pre-query auth stall; the exact internal await and production effectiveness remain unconfirmed.

Concurrent ordinary client GETs share transport and JSON decoding, with independent cancellation and a bounded wait. Completed responses are not retained. Mutation start/completion and mounted-session changes separate subsequent reads from older work. Passive notification-count events reuse a pending read; confirmed mutations still replace it with a fresh read. Private image responses retain `private, no-store`.

The Node 24 gate passed formatting, lint, types, boundaries, all 423 tests, and the production frontend build; Worker dry-run packaging also passed. Synthetic interrupted HTTP refreshes preserve a pre-existing session cookie, and logout still revokes it. Production had no pending migrations. The serving Worker exactly matched the checked bundle, and all 34 direct HTTP checks passed, including current asset bytes, bootstrap/status, invalid sessions, private API/media rejection, origin enforcement, and repeated signed-out startup. No browser, visual, or production signed-in mutation tests were performed. A brief post-release tail and retained-diagnostic query found no startup failures through approximately `2026-10-14T02:00Z`, but did not establish signed-in reliability or hosted CPU cost. This code-only release required no migration, maintenance window, or new backup under the existing cadence.

## Private image-byte cache release (October 13, 2026)

Worker `9b4a3964-af86-44bc-8496-a427d916a2c7` reached 100% at `2026-10-14T03:23:04.346Z`. Posts, grid thumbnails, and both avatar sizes reuse immutable object bytes in a named Workers cache for one hour. Fresh session and feature authorization precede every lookup. Current object selection makes replacement and deletion effective without a cache purge. Client responses remain private/no-store; API data and permission decisions are not cached. A bounded lookup falls back to R2 if the cache is unavailable, and background-fill failure does not fail the streamed response.

The Node 24 gate passed formatting, lint, types, boundaries, all 430 tests, and the production frontend build; Worker dry-run packaging also passed. Real local Workers-cache tests warmed all four variants, proved storage-read avoidance after removing synthetic R2 objects, and denied access through expired/revoked sessions, pending/removed follows, blocks, inactive membership, post/account deletion, and direct cache-key paths while entries remained present. Replacement selected new avatar bytes immediately. Focused failure tests covered lookup errors/timeouts, late completion, failed background fills, and uncached missing objects.

The serving Worker exactly matched the checked bundle. All 32 production HTTP checks passed for exact HTML/JS/CSS/service-worker/manifest/startup bytes, sign-in/bootstrap availability, invalid sessions, private API/media rejection, conditional/range request rejection without authentication, direct internal-key rejection including HEAD, and mutation origin enforcement. Frontend assets were unchanged. The first migration-list query returned a provider authorization error; a retry succeeded and confirmed no pending migrations. No schema, auth credentials, dependency, provider plan, or service-worker behavior changed. No maintenance window, new backup, browser/visual test, or production signed-in mutation was needed. Hosted cache hit rate and image latency remain unmeasured; new safe cache/R2 telemetry supports that follow-up.

## Larger photo originals release (October 15, 2026)

Worker `680137f1-413f-4117-b08f-46172c8adabb` reached 100% at `2026-10-15T17:43:47.545Z`. Posts and profile photos now accept local originals up to 32 MiB and 40 megapixels before the existing 1600px crop encoder runs. Encoded uploads retain the 8 MiB ceiling and existing quality settings. The production dry-run backend bundle exactly matches the previous release; deployment uploaded only changed HTML and JavaScript assets.

The Node 24 repository gate passed formatting, lint, types, boundaries, all 434 tests, and the frontend build before deployment. Production had no pending migrations. All 32 direct HTTP checks passed, including exact deployed assets, sign-in/bootstrap availability, invalid sessions, signed-out private API/media rejection, internal-cache-key rejection, and mutation origin enforcement. No migration, maintenance window, new backup, browser/visual test, or production signed-in upload was needed. Actual device decoding and photo appearance remain unmeasured; the larger-source upload/retry regression uses mocked canvas and decoder boundaries in Node.

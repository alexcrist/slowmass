# Implementation plan

Status: authentication, invitations, profiles, avatars, and follows deployed. Posts, feed, interactions, and notifications are deployed and API-tested. Account deletion, storage quotas, encrypted backup verification, hosted Time Travel drill, and initial usage inspection are implemented. The owner confirmed copying the initial recovery kit off-device. Recurring backups and complete hosted beta verification remain open. Browser and visual testing are prohibited. Check boxes represent observed implementation/verification; a local check is not hosted verification.

## Approach

Aim for an initial end-to-end implementation in a concentrated agentic session, followed by verification and fixes. Do not manufacture week-long sprints or promise that provider setup and production validation fit a fixed number of hours. Email-delivery credentials, account provisioning, and remote runtime behavior are external dependencies. Finish independent local work while those dependencies are pending.

Use small commits with a working vertical slice and acceptance evidence. Implement sequentially unless the user explicitly requests delegation; the stages identify boundaries that could support later parallel work without requiring it. Keep one owner for schema, authorization contracts, and integration.

## 0. Project identity and repository

- [x] Choose Slowmass. The user owns slowmass.com and supplied alexcrist/slowmass.
- [x] Clone the user-provided public repository alexcrist/slowmass; preserve its visibility.
- [x] Commit README, CLAUDE.md, relative AGENTS.md symlink, product contract, architecture, and this plan. Do not add a license that implies an unchosen distribution policy.

Exit: repository exists, symlink is tracked as a symlink, and the design is reviewable. This phase does not provision production infrastructure.

## 1. Runtime and highest-risk integration spike

- [x] Scaffold one strict TypeScript package with React/Vite, Hono, Wrangler, formatting/linting, test runner, and lockfile. Pin compatible versions after checking official docs.
- [x] Verify local static routing, API routing, D1 migrations, R2 access, and production bundling.
- [x] Verify email-link/D1 integration, session signatures, trusted origins, verified-email invitation checks, and logout in the local runtime with simulated email delivery.
- [ ] Complete hosted secure-session verification. First-member email delivery and sign-in at https://slowmass.com are user-confirmed; hosted session expiry/logout and invited-member verification remain.
- [x] Verify private image inspection/re-encoding: real remote processing confirmed output format, orientation, metadata removal, still PNG/WebP, animation rejection, and authenticated avatar/post API flows with isolated synthetic storage; integration tests cover stream limits and quotas.
- [ ] Measure deployed CPU for auth and a private-image request against the free Worker limit. Confirm the actual account supports the planned free services. If deployment prerequisites are unavailable, label local results accordingly and keep this gate open.
- [x] Add reproducible commands for local dev, migrations, checks, and build; document only commands that work.

Exit: one authenticated user can submit an image to a private test path and retrieve processed bytes; a stranger cannot. Record any change to the $0 target before building on a paid dependency.

## 2. Identity, profiles, and relationship privacy

- [x] Implement onboarding, unique handles, private profile reads/edits, exact-handle lookup, and avatar processing.
- [x] Implement invitation eligibility and permanent inviter attribution, with an authenticated invitation form.
- [x] Implement follow request/cancel/accept/deny, unfollow, follower removal, and block/unblock.
- [x] Enforce feature dependency boundaries and active-membership access.
- [x] Establish private-profile/post access predicates.
- [x] Add persistence constraints and integration tests for duplicate/crossing requests, ownership, concurrent transitions, and removed/blocked access.

Exit: two synthetic test users can establish and revoke a relationship; a third user cannot read private profile details or media. UI code provides empty/requested/accepted states.

## 3. Publish and browse photos

- [x] Implement bounded upload reservation, trusted processing, private variants, retry-safe publication, and orphan cleanup.
- [x] Build compose preview/caption/alt-text flow with progress, cancellation, failures, and safe retry.
- [x] Implement own profile posts, private post detail, and chronological home feed from own posts and accepted follows.
- [x] Add explicit cursor pagination, snapshot boundary, navigation history, viewport image loading, and caught-up state.
- [x] Add post deletion with immediate access denial and durable retryable media cleanup.

Exit: upload through the API, reload, and see exactly one published post. A follower sees it in order; pending/stranger/removed users cannot access it by API or saved media URL. Tied timestamps, concurrent inserts, and deletions do not break pagination.

## 4. Interactions and notifications

- [x] Implement idempotent likes/unlikes, bounded flat comments, comment deletion, and batched counts.
- [x] Implement in-app follow-request actions, grouped like notifications, comment notifications, and pagination.
- [x] Ensure notifications and source mutations cannot diverge silently; derive activity from transactionally indexed current source tables.
- [x] Recheck visibility when rendering notifications and navigating to their targets; clean up or hide obsolete events.

Exit: three-user API flow covers following, posting, liking, commenting, accepting/denying requests, retries, and revoked access. Counts and grouped notifications remain correct after unlike/deletion.

## 5. Complete mobile experience and operations

- [x] Implement the user-requested utilitarian interface, with mobile CSS, semantic controls, labels, and focus/touch targets. Review source statically; no browser or visual checks.
- [ ] Cover loading, empty, permission-denied, offline/network-error, quota, and unsupported-photo states. Installable web app is optional; never cache private photos for offline use.
- [x] Implement account deletion and recovery-aware cleanup, per-user upload/storage limits, and retained invitation provenance.
- [ ] Finish broad mutation rate limits and operator invitation/block controls.
- [x] Add aggregate usage inspection, bounded cleanup, cost monitoring instructions, encrypted backup/export tooling, synthetic SQL/photo restore verification, and a hosted Time Travel drill on a disposable database.
- [x] Hand off the initial private recovery kit; the owner confirmed copying it off-device.
- [ ] Establish recurring backups. Current backup creation and off-device copying remain manual.
- [x] Add CI checks for format, lint, types, import boundaries, meaningful tests, migrations on a clean database, and production build. Keep production deploy explicit initially.

Exit: real photos survive a documented restore in a nonproduction environment; deletion remains respected. No credentials or production data appear in test artifacts or logs.

## 6. Beta readiness and deployment

- [ ] Run full API flow with separate authenticated users; review UI semantics and responsive CSS statically. Never run browser or visual tests.
- [ ] Test direct unauthorized requests, stale media URLs, CSRF/origin checks, session expiry, duplicate publication, simultaneous likes, interrupted processing, and retryable cleanup.
- [ ] Seed realistic synthetic follow graphs and posts. Measure feed latency, D1 rows scanned, Worker CPU, and request counts; identify concrete upgrade thresholds from observed usage.
- [x] Configure production resources, secrets, verified email sender domain, and explicit deployment within the user's authorization. Apply each feature migration before dependent code.
- [ ] Verify the actual deployed login/upload/follow/feed/interaction flow. Do not equate a successful build or HTTP 200 with a working app.
- [x] Write the operations runbook with storage controls, retention, recovery quarantine, usage observations, and measured limitations.

Exit: an invited friend can sign in, post, follow another friend, and interact without developer assistance. No open privacy or data-integrity failures; any remaining limitations are explicit.

## October 11 social and navigation update

- [x] Fix accumulated page content by removing duplicate sibling keys and remounting distinct route roots; verify repeated page changes in a Node component test.
- [x] Separate Settings from own/other profiles, show a paginated photo grid, and preserve private post/bio access while exposing username/name/avatar to active unblocked members.
- [x] Keep magic links, clarify invited-member onboarding, recheck sign-in on returning to the window, and confine pasted-link help to installed apps.
- [x] Put installation help only in Settings, retaining native install events across member page changes.
- [x] Add username/avatar feed headers, icon interactions with positive counts, and an authorized paginated Liked by list.
- [x] Establish mutual follows at initial profile completion for inviter/invitee, respecting blocks, inactivity, and later unfollows.
- [x] Add fuzzy name/username discovery, a three-character minimum, debounce, server rate limiting, and stable shuffled directory pages.
- [x] Add inviter-scoped invitation history, immutable issuance timestamps, cancellation, and a copyable message for manual sharing.
- [x] Finish release checks (79 tests, format/lint/types/build and local migrations), verify a fresh encrypted production backup including two images, apply migration 0011, deploy, and verify deployed HTTP boundaries and asset hashes. No browser or visual tests.

## October 11 white interface update

- [x] Replace the tinted canvas/header and raised photo cards with white surfaces, neutral navigation, and subtle gray separators; retain Caveat, Source Sans 3, and green primary buttons.
- [x] Add a desktop icon sidebar with hover/keyboard label expansion and bottom Settings; retain mobile bottom navigation and put mobile Settings in the header.
- [x] Set browser and installed-app launch colors to white, preserving the approved app icons.
- [x] Pass formatting, lint, types, the existing 79 tests, and production build; deploy and verify matching HTML/CSS/JS/manifest plus sign-in availability by HTTP. No schema changes or browser/visual testing.

## October 11 interface cleanup

- [x] Shorten the invitation prompt, use “New post” throughout the UI, and remove the manual Shuffle people control while retaining paginated discovery.
- [x] Move Settings access to a button on the member's own profile and remove global header/sidebar Settings links.
- [x] Prevent Cloudflare analytics injection into HTML without relaxing CSP or disabling asset compression; add the standard mobile web-app metadata tag.
- [x] Pass formatting, lint, types, 79 tests, and production build; deploy and verify matching HTML/CSS/JS, absent analytics injection, compressed assets, and private API/media response headers through HTTP. No browser or visual testing.

## October 11 loading-state audit

- [x] Gate the sign-in form on a completed session check, distinguish unavailable/offline startup from signed-out state, and provide retry plus an HTML loading fallback before JavaScript starts.
- [x] Delay member navigation and onboarding until the own-profile read resolves; show loading during retries.
- [x] Audit feed/profile/detail, discovery, relationships, activity, invitation history, comments, and likes; use explicit loading/error/success reads with request cancellation and no stale results or premature empty states.
- [x] Refresh successful invitation/follow/read mutations with visible loading, and add missing retry controls for photo details and liked-by lists.
- [x] Pass 18 new delayed-response component regressions and the complete 97-test check, deploy, and verify the loading HTML, matching compressed assets, sign-in availability, and private API headers through HTTP. No browser or visual tests.

## October 11 activity and navigation cleanup

- [x] Remove persistent refresh buttons, retain failure-only Retry controls, and support refreshing the first page by reselecting Feed, Activity, or own Profile; keep a full Reload app control in Settings.
- [x] Keep follow requests within Activity using All/Follow requests filters, inline decisions, and server filtering before pagination; resolve old request-page links to Activity.
- [x] Replace visible end-of-posts text with a neutral check-circle icon and accessible label.
- [x] Add labeled arrow back controls to secondary pages and inline photo details; use safe parent destinations for direct links.
- [x] Pass formatting, lint, types, 106 tests, and production build; deploy and verify matching compressed assets, sign-in availability, and anonymous filtered-activity rejection through HTTP. No database migration, browser test, or visual test.

## October 11 profile and onboarding release

- [x] Replace the feed end icon with a short horizontal line and remove the visible ordering label.
- [x] Add bottom desktop-sidebar Settings access, omit the desktop Settings back link, standardize Settings rows, and animate the wordmark with reduced-motion support.
- [x] Use one chronological, paginated Activity timeline with inline request decisions.
- [x] Move own-profile Settings to a heading gear and add Posts/Following/Followers tabs that retain the profile header.
- [x] Audit user-identity profile links and add contextual profile back links, including return to the selected profile tab.
- [x] Remove the composer description field while preserving the draft contract and existing descriptions.
- [x] Keep back navigation only on other members’ profiles and simplify the profile tabs to one divider.
- [x] Require profile photos during resumable onboarding and enforce the requirement on member APIs; support replacement without removal.
- [x] Add drag/keyboard/zoom cropping, bounded encoding, and safe upload retries for onboarding and profile editing; enable isolated local image processing.
- [x] Remove optional-avatar rendering and public flags; exclude unfinished onboarding profiles from discovery, profile visits, and connection lists.
- [x] Open cropping directly from photo selection and save on crop confirmation, without a separate upload form.
- [x] Pass formatting, lint, types, 123 tests, and the frontend build. No browser or visual tests.
- [x] Confirm the updated local server serves matching HTML/JS/CSS and rejects unsigned profile API requests.
- [x] Deploy with user authorization as Worker `df16892c-e496-4eb0-88b6-7313d8680907`; verify matching live HTML/JS/CSS/manifest, available sign-in, and private API/media responses through direct HTTP. No migrations were pending. Create and verify an encrypted production backup before release.

## October 11 performance work

- [x] Replace global feed/profile scans with indexed, bounded author candidates and hydrate only the selected page; retain current visibility and snapshot pagination.
- [x] Verify the actual application query against the historical SQL on one million photos, with/without statistics, 0/50/500 follows, and newer/older pages; verify both profile grids match too.
- [x] Combine availability, session and profile startup into one private bootstrap response, preserving loading/error/onboarding behavior.
- [x] Generate 480px private grid thumbnails on upload, prioritize the first feed photo, and include every variant in quotas, cleanup, account deletion, and encrypted backups.
- [x] Add bounded legacy-thumbnail conversion with full-image fallback and duplicate-attempt protection.
- [x] Add request-scoped D1 counters, response timing headers, and sampled sanitized route metrics without another service or telemetry database writes.
- [x] Pass formatting, lint, types, 136 tests, and production build, including real local image processing, synthetic backup restoration, read-cost regression checks, and privacy/pagination tests. No browser or visual tests.
- [x] Apply the thumbnail migration locally and verify matching served HTML/JS/CSS, private bootstrap output, anonymous feed/media rejection, and request timing headers through HTTP.
- [x] Verify migration `0012_post_thumbnails.sql` is applied in production and deploy the current implementation.

## October 11 focused posts

- [x] Replace inline profile/Activity details with a dedicated post route, also accessible from feed photos, with contextual back navigation and a safe direct-link fallback.
- [x] Preserve parent-list pagination cursors across navigation while refetching authorized content; keep route roots unmounted and discard remembered cursors on reselection or logout.
- [x] Open comments initially on focused posts and use a compact horizontal composer in both feed and post pages, preserving multiline input, disabled pending submissions, and retry IDs.
- [x] Pass formatting, lint, types, all 142 tests, and production build; verify matching local HTML/JS/CSS through HTTP. Focused regressions cover all three post entry points, pagination return/reselection, direct-link errors, profile/back navigation, deletion, and comment retry IDs. No browser or visual tests.
- [x] Deploy with user authorization; see the daily invitation limit release below.

## Post controls, comment likes, and invitation email

- [x] Add a centered post header with an owner-only three-dot caption-edit/delete menu shared by feed and focused views; preserve image and publication time.
- [x] Use compact relative timestamps, consistent icon/count spacing, and native paginated likers dialogs for posts and comments.
- [x] Keep comments flat and add a compact avatar/name/body layout plus authorized, idempotent comment likes and bounded account cleanup.
- [x] Add the profile invite shortcut and separate invitation history timestamps/actions.
- [x] Send invitation email through the existing provider, name the inviter and Seattle description, preserve delivery timestamps, and support bounded deduplicated retries.
- [x] Pass formatting, lint, types, all 154 tests, and production build. Apply migrations 0013/0014 locally; verify matching local HTML/JS/CSS and anonymous rejection on the new edit/comment-like/invitation-send routes over HTTP. Email tests simulate the provider; no real invitations or browser/visual tests were used.
- [x] Verify migrations 0013/0014 are applied in production and deploy the current implementation.

## Account and photo editing

- [x] Simplify onboarding with a narrow form, spaced helper text, and a quiet account-switch action; keep deletion in Settings.
- [x] Use one native dialog component for all modals, including cropping; dismiss on complete backdrop clicks while preserving save and drag guards.
- [x] Add avatar connection rows, compact relationship controls, removal/unfollow confirmations, and balanced profile follow spacing.
- [x] Share the vertical overflow menu between post controls and profile unfollowing/blocking, with keyboard and outside-dismissal behavior.
- [x] Add freeform post cropping with draggable edges/corners, keyboard controls, original-photo recropping, bounded local encoding, and stable upload retries.
- [x] Allow unique username changes while retaining account-ID relationships and content; release old names without redirects, as requested.
- [x] Pass formatting, lint, types, 169 tests, and the production build. No database migration is needed. Deployed; see the daily invitation limit release below.

## Welcome invitation eligibility

- [x] Keep uninvited addresses on the welcome form with invitation instructions; distinguish eligibility failures from other sign-in errors and preserve authentication-response privacy headers.

## Large profile photos and installation help

- [x] Store private small and large avatar variants for new uploads, with bounded processing/storage accounting and atomic replacement.
- [x] Include both objects in deletion and backup/restore, leaving existing photos without a backfill.
- [x] Use a frameless image dialog with a backdrop close control from Profile and Edit profile.
- [x] Verify and update platform-specific installation instructions against vendor documentation.
- [x] Pass formatting, lint, types, 181 tests, and the production build. Back up local D1, apply migration 0015 locally, and verify matching served assets plus anonymous rejection for both avatar sizes over HTTP.
- [x] Verify migration 0015 is applied in production and deploy the current implementation.

## Direct invitation joining

- [x] Send personal seven-day join links in invitation emails; preview without consuming and accept through an explicit same-origin POST.
- [x] Use Better Auth identity/session APIs, bind acceptance to the exact invitation, and preserve attribution, timestamps, and mutual follows.
- [x] Enforce single-use membership across concurrent requests and all joining paths; keep ordinary ten-minute login links as recovery.
- [x] Encrypt frozen email retry payloads and preserve provider deduplication, delivery budgets, and cancellation semantics.
- [x] Add confirmation/loading/error/account-switch UI and document old-email behavior and migration sequencing.
- [x] Pass formatting, lint, types, all 211 tests, and the production build. Back up local D1 and apply migration 0016; verify database integrity, matching served assets, invitation-page headers, and invalid-credential/origin/GET rejection over HTTP. No browser or visual tests.
- [x] Verify migration 0016 is applied in production and deploy the current implementation.

## Completion evidence

For each stage, record commands/results in the work report, not as permanent design prose. Keep current docs concise. The final handoff includes the repository, local setup, deployment state, features completed, tests actually executed, observed cost assumptions, and specific unfinished prerequisites. A working local application and a verified deployed beta are different completion states.

## October 11 software-design audit fixes

- [x] Commit processing allowance and post drafts atomically; cover interrupted legacy reservations, insertion rollback, uncertain commits, and concurrent retries.
- [x] Preserve API error status and recover expired sessions centrally without reacting to aborted or stale-session responses.
- [x] Replace Activity history aggregation with an indexed, transactionally maintained source directory and targeted acknowledgements; preserve current privacy, counts, sorting, cursor compatibility, and read-version semantics.
- [x] Move discovery quotas, relationship resolution, invitation persistence/retention, avatar lookup, and auth/email retention into their owning modules.
- [x] Define public feature entry points and enforce dependency boundaries for re-exports, dynamic/CommonJS/type imports, aliases, cycles, and misplaced database calls.
- [x] Pass formatting, lint, types, all 231 tests, and the production build; apply migration 0017 to the isolated local database. Production migration 0017 and deployment are verified in the daily invitation limit release below.

## Daily invitation limit removal

- [x] Remove the per-member daily invitation cap and update form/error copy and documentation. Seven-day expiry, eligibility, retry deduplication, and shared email-delivery budgets remain enforced.
- [x] Verify six concurrent invitations from one member and duplicate retry behavior through the Worker/D1 API with a simulated email provider.
- [x] Pass formatting, lint, types, all 232 tests (including import boundaries), and the production build. No browser or visual tests.
- [x] Deploy with user authorization as Worker `e9fdfcac-b095-487d-aed1-7c0cc19ef5e1`. Verify the encrypted production backup (three images), migrations 0001–0017 already applied, matching deployed assets, and 19 direct HTTP checks. No migration was needed or applied during this release.

## Own posts in the home feed

- [x] Include own published posts alongside accepted follows in the same newest-first snapshot pagination, without storing self-follows or changing profile lists.
- [x] Verify mixed-author ordering, tied timestamps, concurrent inserts, deletion, no accepted follows, hidden drafts/failed uploads, revoked access, and bounded reads against Worker/D1.
- [x] Pass formatting, lint, types, all 233 tests, and the production build; verify a fresh encrypted production backup including three images.
- [x] Deploy as Worker `30a558f0-3958-463b-bf26-4b8cec8e792b` and verify 100% traffic plus 12 direct HTTP/asset checks. No database migration or browser/visual testing.

### Confirmation and startup recovery follow-up (October 11, 2026)

- [x] Require confirmation for profile unfollow/block actions and comment deletion, retaining failed actions for retry and preventing dismissal/resubmission while pending.
- [x] Replace the comment delete label with an accessible trash icon and align own-profile Invite/Settings beside the identity group at the top of the header.
- [x] Bound the initial bootstrap request to 15 seconds and offer retry without treating a timeout as sign-out; ignore late responses.
- [ ] Identify the cause of the reported intermittent desktop/mobile startup stalls from the affected request. Anonymous HTTP health checks and low measured usage do not establish signed-in startup reliability.

### Activity simplification (October 11, 2026)

- [x] Remove manual read acknowledgement and unread labels. Keep one newest-first timeline of requests, grouped likes, and comments, with inline Accept/Deny and explicit Newer/Older pagination.
- [x] Remove acknowledgement API/domain code and read-marker joins without altering historical migrations or deleting existing records. Account deletion retains historical-marker cleanup.
- [x] Verify mixed activity pagination, stable repeated reads without acknowledgement writes, hidden/deleted source behavior, and bounded query work using local component and Worker/D1 checks.

### Profile, portrait, and Activity refinements (October 12, 2026)

- [x] Move profile Unfollow into the overflow menu above Block account, retaining confirmation and failure recovery. Keep request/cancel controls inline.
- [x] Let normal portraits fill the feed, focused-post, and upload-preview width, with a height limit of twice the container width for unusually tall images and no cropping.
- [x] Make like/comment Activity rows native post links with private thumbnails on the left, keeping request decisions independently operable and preserving return pagination.

### Unified activity and automatic read state (October 12, 2026)

- [x] Keep requests, grouped likes, and comments in one paginated timeline and add one numbered unread badge.
- [x] Acknowledge items after 250 continuous milliseconds of summary visibility, independently of follow decisions; reset incomplete timers when hidden/offscreen and exclude mobile navigation.
- [x] Add migration 0018 for transactionally maintained source receipts, monotonically increasing versions, one-time legacy-read backfill, and indexed unread counts. Preserve permissions and source cleanup.
- [x] Verify stale/duplicate receipts, tied timestamps, request recreation, hidden/deleted sources, atomic rollback, migration backfill, timer reset, batched retries, and count polling in isolated Node/Worker/D1 tests.
- [x] Pass the repository gate (247 tests), restore-check a fresh 14-image production backup, apply migration 0018, deploy Worker `72dcf542-db12-415e-a0f9-2ea530766f35` at 100%, and pass 11 direct HTTP checks plus receipt/foreign-key integrity checks.
- [x] Document future Web Push mapping to the same notification identities and versions; keep delivery, subscriptions, and prompts unimplemented.

## Optional Web Push — October 12, 2026

- [x] Add an explicit per-device Settings opt-in with enable/disable, permission/error states, and iPhone/iPad Home Screen guidance.
- [x] Reuse Activity identities, versions, grouping, visibility, and read state in encrypted push delivery; receiving a push never marks it read.
- [x] Persist delivery intent atomically, coalesce likes, lease bounded batches, retry failures, and cancel on read/removal/session revocation.
- [x] Keep service-worker behavior limited to generic alerts and authorized Activity links; no private response cache or email activity delivery.
- [x] Pass full repository gate (274 tests), verify the encrypted 14-image backup, configure stable VAPID keys, apply migration 0019, and deploy Worker `6da41271-6869-4ff5-9866-cd2497eefa76` at 100%. Fifteen direct HTTP checks passed, with no foreign-key violations or missing receipts; push tables were empty by default.
- [ ] Confirm actual permission and OS delivery on an opted-in device; browser testing remains prohibited. The member reported successful Android opt-in after retry on October 12, and aggregate inspection subsequently found one registered device; OS delivery is still unverified.

## Other members’ profile connections — October 12, 2026

- [x] Reuse Posts, Following, and Followers tabs on accepted-follow profiles, retaining the identity header and return navigation. Other members’ lists link to profiles without owner management actions.
- [x] Authorize profile connection pages for owners and current accepted followers; keep requests/blocks owner-only and filter hidden accounts before bounded pagination.
- [x] Pass formatting, lint, types, focused component/Worker privacy and pagination regressions, all 295 tests, and the production build. No browser or visual testing.
- [x] Re-run the full gate (296 tests), verify a fresh 16-image encrypted backup, and deploy Worker `64ae2674-5fb6-411e-a7c0-9d5264ebd7fd` at 100%. All 23 direct production HTTP checks passed; no migration was needed.

## Intermittent startup recovery — October 12, 2026

- [x] Inspect live usage, D1 query durations, the startup flow, and authentication initialization; identify an upstream Workers failure mode present in the installed library without claiming it reproduces the production incident.
- [x] Remove the request-owned dynamic async-hooks import, reuse only initialized auth instances, and add bounded authentication failures without replaying mutations or signing users out on timeouts.
- [x] Separate database binding wait from SQL execution, log unfinished requests with safe counters, bound list/detail reads, and add independent pre-bundle recovery.
- [x] Pass the isolated release gate (286 tests), verify a fresh 16-image encrypted backup, deploy Worker `83276013-befe-46aa-8afa-69d1db25e09a` at 100%, and pass 17 production HTTP checks. Concurrent profile-connection work was excluded from this release and preserved in the shared workspace.
- [ ] Confirm the production root cause from an affected request, or establish whether stalls recur after the mitigation.

## New-follower activity and push opt-in recovery — October 12, 2026

- [x] Add new-follower events after acceptance and invitation photo completion, using Activity read versions, generic opt-in push, and current visibility. Do not backfill existing accepted follows or replay on edits/retries.
- [x] Preserve receipts, revision history, and queued pushes atomically through migration 0020; test failure rollback and subsequent writes in isolated D1.
- [x] Reproduce a pending Better Auth runtime schema verdict blocking subsequent sessions; disable request-time inspection and explicitly validate migrated auth tables in CI, including a deliberate schema-drift failure.
- [x] Test a delayed Android permission response, focus return, and retry after a temporary registration error with Node component tests. The member reports successful retry; the exact failing production request was not captured.
- [x] Pass formatting, lint, types, all 317 tests, the production frontend build, and the production Worker dry-run bundle; review the release diff against the preceding deployed source. No browser or visual testing.
- [x] Verify a fresh encrypted 16-image backup, apply migration 0020 atomically during maintenance, preserve all eight activity sources/receipts and the registered device, then deploy Worker `9b60b1dd-fcc6-4150-a2b4-2ba7f038f01d` at 100%. All 23 direct HTTP checks passed, with no foreign-key violations, missing receipts, or pending migrations. Actual OS delivery and the original production timeout cause remain unverified.

## Wishlist and like alignment — October 12, 2026

- [x] Create a feature wishlist containing only user tagging in comments; link it from the repository README. Tagging remains unimplemented.
- [x] Remove the post heart's leading visual indent while retaining its 44px button and icon-to-count spacing. Formatting, lint, types, all 317 tests, and the production build passed; no browser or visual testing.
- [x] Deploy the like-alignment adjustment with the focused photo viewer in Worker `566e2eaf-3821-4318-ae85-9487adebdb3d`.

## Focused photo viewer — October 12, 2026

- [x] Make the focused post photo itself open the shared profile-photo-style viewer at widths of 900px and above. Keep full-width mobile photos noninteractive, preserve feed links, and close the viewer when narrowing the viewport or leaving the post.
- [x] Share image loading/error/retry and dialog behavior with profile photos, retaining private media URLs and alt text. No separate visible enlarge control.
- [x] Pass formatting, lint, types, all 319 tests, and the production build. Verify responsive availability, retry, dismissal, navigation cleanup, and unchanged avatar/feed behavior in Node tests; no browser or visual testing.
- [x] Confirm the existing username rule already requires 3–30 characters in the profile form and server validation; no username behavior change was needed for a three-character minimum.
- [x] Verify a fresh encrypted 16-image backup and deploy Worker `566e2eaf-3821-4318-ae85-9487adebdb3d` at 100%. All 23 direct production HTTP checks passed, including matching frontend assets and private API/media boundaries. No migrations were pending.

- [x] Implement one bounded startup GET retry and capped, privacy-safe failure diagnostics with retention.
- [x] Apply migration 0021 and deploy startup recovery; verify production schema, assets, and diagnostic endpoint safeguards.
- [ ] Observe a real retained startup diagnostic and the scheduled expiry cleanup in production (retention and cleanup passed isolated D1 tests).

## Lowercase app name

- [x] Use `slowmass` consistently in user-facing titles, metadata, interface copy, notifications, and emails; preserve the existing favicon artwork.
- [x] Reduce the full loading wordmark to 26px across viewport sizes, including static startup, retry, and invitation loading, while preserving touch targets.
- [x] Deploy lowercase branding and compact loading headers as Worker `26c8374b-4abf-464f-9e04-cf3168a0934b` at 100%; all 326 tests and 31 final live HTTP checks passed.

## Shared invite links and joined-invitee Activity

- [x] Add shared links before personal email invitations, defaulting to 100 verified sign-ups, with owner-only labels, seven-day expiry, copy/revoke and paginated history/joiners.
- [x] Bind email verification to the selected shared link; atomically create immediate membership and consume capacity without automatic follows or pending-place reservations.
- [x] Preserve existing personal invitation behavior, immutable attribution, account deletion and quarantined restore semantics.
- [x] Add one joined-invitee Activity event after required photo completion for both invite types, with a private avatar, full profile-row link, existing read tracking and generic opt-in push; no historical backfill.
- [x] Keep old open clients compatible through an explicit joined-event capability on list/count reads.
- [x] Complete formatting, lint, type and boundary checks, all 344 tests, production frontend build, Worker dry-run bundle, and final diff review. No browser or visual testing was performed.
- [x] Apply migrations 0022–0023 with verified backup and atomic Activity preservation; deploy Worker `c47e6ec6-f9c6-46f9-970e-dde9ba123a21` at 100%. All 43 direct production HTTP checks passed.

## Simplified invite links

- [x] Remove name/limit controls and persisted names; identify links by server-recorded creation date/time.
- [x] Enforce 100 uses for new links and migrate existing capacities without changing provenance or usage.
- [x] Complete formatting, lint, types, boundary checks, all 346 tests, and the production build; migration preservation/rollback and creation retry tests passed.
- [x] Deploy migration 0024 and Worker `b773910d-ad4b-4f97-8faa-be8faac0c6cb` at 100%, with a verified encrypted backup, preserved database aggregates and 43 final live HTTP checks.

## Onboarding return audit

- [x] Verify both invitation types recover through ordinary sign-in at both incomplete profile steps, preserve membership and shared capacity, and gate deep links/member APIs until a photo is saved.
- [x] Remove the incorrect generic promise of automatic follows; personal invitation acceptance still explains its mutual follows.
- [x] Pass all 350 tests and repository gates; deploy Worker `6213361c-8383-4c59-af90-f4cd1fb0b003` with a verified backup and 43 final live HTTP checks. No migration required.

## One current invite link

- [x] Replace shared-link history with one rotating credential per inviter; copy reuses a valid credential and creates a fresh seven-day link after expiry, without extending expiry on copy.
- [x] Put Replace link in the three-dot overflow menu with confirmation, pending controls, and safe retry identity; remove shared history/count/joiner panels.
- [x] Remove capacity/counter enforcement and retain immutable invitation type, inviter, timestamps, onboarding recovery, personal invitation behavior, and joined Activity.
- [x] Bind verification claims to the exact credential version/hash, retain failed claims through the email-token lifetime, and enforce atomic membership checks under replacement/join races; retain the selected source across auth hooks when cleanup removes a claim during verification.
- [x] Add migration 0025 to discard unused shared links, preserve personal/member/Activity state, and abort on unexpected shared redemptions or claims. Document maintenance and incompatible rollback behavior.
- [x] Pass formatting, lint, types, boundaries, all 366 tests, the production frontend build, and the production Worker dry-run bundle. Focused checks cover more than 100 joins, bounded personal-history reads, concurrent copies/replacements/joins, both auth-cleanup races, migration preservation/rollback, and quarantined restore. No browser or visual testing.
- [x] Verify a private local D1 backup, apply outstanding local migrations through 0025, and confirm SQL integrity, foreign keys, unchanged membership count, removed capacity fields, and the personal-history index.
- [x] Verify the encrypted 16-image cutover backup, apply migration 0025 atomically during maintenance, and deploy Worker `dbce0dd5-ce10-4508-bab0-a7f879a7b98e` at 100%. Preserve all six memberships, ten invitations, content, relationships, Activity/receipts and other account state; pass SQL integrity, foreign keys, schema/provenance comparisons, and 52 final direct HTTP checks. No browser, visual, or production sign-up tests.
- [x] Record the owner’s deployment preference: routine code-only deploys do not require a new backup; retain the documented cadence and migration/recovery backups.

## Washington API placement

- [x] Configure production fetch placement near Washington; deploy version `25109002-0d9d-4403-9fed-97a7ea5a4aa5` at 100% and observe `remote-SEA` response headers.
- [x] Confirm unchanged deployed Worker bytes and frontend assets; pass all 367 tests, formatting, lint, types, build, dry-run packaging, and 12 direct HTTP/asset checks.
- [x] Compare 12 signed-out session probes before and after: handler median 319 ms to 62 ms. Record ingress differences, limited sample size, current D1/R2 locations, and rollback in operations.
- [x] Observe successful private-image handlers at 202–241 ms and the unread badge at 73 ms during the owner's app test. Record these as individual samples, not matched benchmarks or percentiles.
- [ ] Measure signed-in feed, profile, and Activity list distributions after placement; signed-out probes and individual media/badge samples do not establish their improvement.

## Hourly Web Push fallback

- [x] Change the delivery cron from every minute to hourly, preserving immediate mutation dispatch and quarter-hour maintenance. Ignore obsolete cron expressions during schedule propagation.
- [x] Document delayed like groups, retry eligibility, and the five-deliveries-per-hour idle backlog limit.
- [x] Pass formatting, lint, types, boundaries, all 367 tests, production frontend build, and the Worker dry-run bundle. Worker/D1 tests verify hourly delivery, quarter-hour cleanup without delivery, ignored obsolete schedules, retries, and current authorization.
- [x] Deploy Worker `e6fba1ab-48cd-4c2a-81d9-b89127146d57` at 100%; verify exact checked Worker/asset bytes, hourly delivery and quarter-hour maintenance configuration, and 12 direct HTTP checks. Actual hourly cron execution and OS delivery require separate observation. No migration, paid service, queue, or foreground performance change was made.

## Fewer request round trips

- [x] Enable native Better Auth session/user joins and combine active-membership/photo-completion checks without cross-request caching.
- [x] Return authoritative counts from post like/unlike mutations and remove the client’s follow-up detail request; recheck unlike access inside its mutation.
- [x] Start profile Posts reads alongside profile metadata, withholding rendering until authorized and cancelling on denial/navigation.
- [x] Add separate R2 lookup timing while preserving private streaming and existing image variants; avoid speculative quality/caching changes.
- [x] Pass all 371 tests, formatting, lint, types, boundaries, build and dry-run packaging. Deploy Worker `d6a9dde1-cdff-4966-ba05-2e27e36be1dd` at 100%; verify exact Worker/asset bytes, Seattle placement, and 12 direct HTTP/asset checks.
- [ ] Collect representative signed-in measurements and select any further photo optimization from storage/download evidence.

## Pill comment composer

- [x] Update the shared feed/detail composer with a pill outline, a Douglas Fir circular send button and white icon, and automatic one-to-six-line sizing with internal scrolling for longer drafts.
- [x] Remove the form's outer margins and use matching spacing below the composer and between the feed divider and the next post header. Preserve accessible labeling, keyboard focus, 44px send target, pending states, and retry behavior.
- [x] Pass formatting, lint, types, boundaries, all 371 tests, and the production frontend build. No browser or visual testing.
- [x] Deploy the composer as Worker `4f4bf43f-ae1b-4993-9d21-2b4fc6bb356d` at 100%; verify matching HTML/JS/CSS and nine sign-in/private API/media/origin probes through direct HTTP.
- [x] Reduce the comment trash icon to 16px and align timestamp, like total, and deletion with consistent line height and even visible gaps, retaining the 44px delete target.
- [x] Pass the full 371-test gate and deploy the metadata alignment adjustment as Worker `39e60c73-a812-403a-8323-e16a571535dc`; all 12 direct HTTP asset and API checks passed. No browser or visual testing.

- [x] Refine metadata after owner feedback: 14px trash icon lifted 2px for optical alignment and 16px gaps. All 371 tests and repository gates passed; deploy Worker `c4fa15a5-de90-408a-8527-8b194478721b` and verify exact HTML/JS/CSS, sign-in availability, and signed-out comment rejection by HTTP. No browser or visual testing.

## Compact composer refinement

- [x] Increase the left text inset to 22px, use matching 15px comment/caption type, and reduce the initial composer height to 44px while preserving six-line growth and internal scrolling.
- [x] Make the opaque send circle flush with the outer edges, hide the outline behind it even when disabled, and optically center the plane icon. Replace the text-field outer focus ring with a single darker inset outline.
- [x] Pass formatting, lint, types, boundaries, all 371 tests, and the production build. Deploy Worker `e3d439aa-07c3-423a-8ec5-cb7ac489ebb6`; verify exact HTML/JS/CSS, available sign-in, and private signed-out comment rejection through HTTP. No browser or visual testing.

## Comment stack spacing

- [x] Remove metadata row/timestamp/control minimum-height rules and the delete control’s generic icon-button sizing. Use natural 20px text lines and button padding to preserve 44px targets.
- [x] Give comments only 16px bottom padding, remove default list margins, and separate comment styles from generic list-row padding/borders.
- [x] Pass formatting, lint, types, boundaries, all 371 tests and the production build. Deploy Worker `22cf3368-b681-47e2-92b6-7114e69b2f3c`; verify matching HTML/JS/CSS and sign-in/private-comment HTTP probes. No browser or visual testing.

- [x] Standardize the post-icon-to-first-comment, between-comment, and last-comment-to-composer gaps at 12px. Pass all 371 tests and repository gates; deploy Worker `6149b78f-3e87-47cf-a7a5-f62c85ae26ad` and verify exact HTML/JS/CSS plus sign-in/private-comment HTTP probes. No browser or visual testing.

## Activity relationship actions — October 13, 2026

- [x] Add private avatars and right-side, vertically centered actions to follow requests/new followers; use the primary green Accept button.
- [x] Offer Follow back only for eligible new-follower events, reusing normal follow requests. Persist independent, exact-version dismissal across devices with migration 0026.
- [x] Pass formatting, lint, types, boundaries, all 376 tests, and the production frontend build. Verify follow-back eligibility, owner/version-scoped dismissal, retries, authentication/origin checks, and preservation of Activity receipts/pushes through the additive migration. No browser or visual testing.
- [x] Apply migration 0026 after a verified encrypted 28-image backup; preserve Activity aggregates and deploy Worker `63400a03-dbbf-4ca0-ab27-d79040de83d9` at 100%, including the requested green Activity unread badge. Pass all 376 tests and repository gates plus 13 direct HTTP/asset checks; no pending migrations or foreign-key violations. No browser or visual testing.

## Optional device setup during onboarding

- [x] Reuse installation/notification controls after required profile-photo setup, with Continue and member navigation available throughout.
- [x] Keep Android choices independent, guide iPhone/iPad through Home Screen installation, omit desktop installation, and recognize existing permissions/subscriptions.
- [x] Persist pending setup for new members, resume through installed-app sign-in, and remember dismissal without enrolling existing members.
- [x] Support independent endpoints sharing a copied session cookie; preserve queues and revoke all copies on logout.
- [x] Recover permission changes and registration failures without repeated permission/subscription work; prefer identifiable installed windows on notification clicks.
- [x] Pass the Node 24 repository gate: formatting, lint, types, boundaries, all 401 tests, and the production frontend build. Review the diff, migration preservation/rollback, copied-session ownership, permission recovery, optional navigation, and platform permutations. No browser or visual testing.
- [x] Apply migration 0027 and matching deployment under maintenance with a verified encrypted backup, preserved aggregates, clear foreign keys, no pending migrations, and 28 direct HTTP checks. Worker `fc9b9954-e5fa-47d1-9bab-bfc8fc83b6d9` receives 100% of traffic; maintenance is disabled.
- [ ] Confirm real-device installation handoff and OS delivery separately; automated component/API tests do not prove platform behavior. Browser/visual testing remains prohibited.

## Mobile profile tab spacing — October 13, 2026

- [x] Restore the 16px mobile tab inset through the profile loading/authorization wrapper, retaining the edge-to-edge photo grid on own and accepted-follow profiles.
- [x] Pass formatting, lint, types, boundaries, all 401 tests, and the production build. Deploy Worker `2c9d9137-8e19-43b4-9578-f836e18f3bd5` at 100%; pass ten direct HTTP checks, including exact deployed assets and private API/media/origin boundaries. No browser or visual testing.

## Consistent Activity images — October 13, 2026

- [x] Use one fixed 64px image size across requests, followers, joined invitees, likes and comments, retaining circular avatars and square post thumbnails. Pass formatting, lint, types, boundaries, all 401 tests and the production build. Deploy Worker `ee288a0e-0cb9-42a5-acdd-eb38658a4a2a` at 100% and pass 28 direct HTTP checks, including exact deployed assets. No migration, maintenance window, browser or visual testing.

## Touch cropping and mutation refresh audit — October 13, 2026

- [x] Add two-finger pinch zoom and repositioning to the profile-photo crop editor, with bounded fractional coordinates, one-finger continuation, pointer cancellation, and unchanged keyboard/slider controls.
- [x] Hide the installation section during optional setup when running in the installed app; remove the sign-out notification sentence. Keep installation launch guidance in ordinary browser tabs.
- [x] Keep profile identity mounted after follow requests/cancellations. Retain unaffected Activity, connection, comment, and feed rows during mutation revalidation; immediately remove confirmed deletions/resolved requests and disable stale actions. Preserve open comments and drafts when refreshed counts arrive.
- [x] Audit action-triggered reloads, image URLs, and component keys. Likes, caption edits, and notification read acknowledgements already avoid whole-list refreshes. Retain explicit navigation/pagination/retry reads, profile-content clearing after unfollow/block, avatar replacement reloads, and bounded text-only invitation refreshes. No persistent private cache or authorization bypass was added.
- [x] Pass the Node 24 repository gate: formatting, lint, types, boundaries, all 413 tests, and the production build. Node component tests verify retained image element identity, denied/late refresh handling, gesture transitions, and installed-app setup. No browser or visual testing; network byte savings and real-device gestures are unmeasured.
- [x] Deploy Worker `cfc9f073-d7e2-4c6d-b96f-b6f9b0f81963` at 100% and pass all 36 direct HTTP checks, including exact deployed assets, invitation pages, sign-in/bootstrap availability, private-resource rejection, and trusted-origin enforcement. No pending migrations or maintenance window; no browser or visual testing.

## Auth isolation and redundant reads — October 13, 2026

- [x] Capture a real startup session timeout before any D1 query, with a correlated successful automatic retry; retain the evidence and its limits in operations.md.
- [x] Remove cross-request auth-instance and measured-environment reuse while preserving cookies, signing secrets, session records, expiry, origin checks, and fresh membership checks. Add safe session dispatch/endpoint/lookup markers.
- [x] Share only concurrent ordinary GET requests, with separate cancellation, bounded waits, no completed-response cache, and separation at mutation/session boundaries. Coalesce passive unread-count refresh events while confirmed mutations still force a new read.
- [x] Pass Node 24 formatting, lint, types, boundaries, all 423 tests, frontend build, and Worker dry-run packaging. Synthetic interrupted HTTP refreshes preserve a pre-existing cookie and subsequent logout still revokes it. Deploy Worker `03674e2e-1f0f-439c-a0c3-f7cb43ca449b` at 100%, match its checked bundle and frontend assets exactly, and pass 34 direct HTTP checks. No migrations, browser testing, or visual testing.
- [ ] Observe signed-in production refreshes and retained diagnostics after release, including hosted CPU usage from repeated auth initialization. The exact internal await in the captured old request remains unknown.

Private image bytes remain uncached by the browser (`private, no-store`). A future measured change can cache immutable object bytes behind per-request Worker authorization; do not cache permission decisions or expose a public cache URL. No image-cache change is part of this release.

## Private image-byte caching — October 13, 2026

- [x] Add a named Worker-internal cache keyed by the authorized immutable object variant, shared by posts and avatars; retain per-request authentication/authorization and private/no-store client responses.
- [x] Bound cache lookup waits and fall back to R2, stream misses with best-effort background fills, retain no denied/missing results, and record content-free cache/R2 measurements.
- [x] Verify warm-cache privacy, replacement, deletion, logout/expiry, failure recovery and actual R2-read avoidance in isolated Workers/D1/R2/Cache tests. Pass Node 24 formatting, lint, types, boundaries, all 430 tests, frontend build, and production Worker packaging.
- [x] Deploy Worker `9b4a3964-af86-44bc-8496-a427d916a2c7` at 100%; verify the serving Worker matches the checked bundle and pass all 32 direct HTTP checks for exact assets, private API/media boundaries, and internal cache-key rejection. No migrations, browser testing, or visual testing.
- [ ] Measure hosted cache hit rate and signed-in image latency separately from local correctness tests; cache hits save R2 reads but retain authorization queries and client downloads.

## Larger local photo originals — October 15, 2026

- [x] Separate the local source-file limit (32 MiB) from the encoded upload limit (8 MiB) for posts and avatars, allowing the existing 1600px crop encoder to process larger originals. Preserve the 40-megapixel decoded-source ceiling, quality settings, server validation, and upload retry bytes.
- [x] Pass the Node 24 repository gate: formatting, lint, types, boundaries, all 434 unit/integration tests, and the production build. Verify a 12 MiB original reaches cropping and uploads only the encoded bytes, retries reuse them, all supported formats accept the 32 MiB boundary, and oversized/undecodable sources fail. Canvas and decoder calls are mocked in Node; no browser or visual testing or new real-device quality measurement.
- [x] Deploy Worker `680137f1-413f-4117-b08f-46172c8adabb` at 100% and pass all 32 direct HTTP checks, including exact deployed assets, sign-in/bootstrap availability, private API/media rejection, and origin enforcement. The backend bundle matches the preceding release; no migrations, maintenance window, browser or visual testing.

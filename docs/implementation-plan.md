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
- [x] Implement own profile posts, private post detail, and chronological home feed from accepted follows only.
- [x] Add explicit cursor pagination, snapshot boundary, navigation history, viewport image loading, and caught-up state.
- [x] Add post deletion with immediate access denial and durable retryable media cleanup.

Exit: upload through the API, reload, and see exactly one published post. A follower sees it in order; pending/stranger/removed users cannot access it by API or saved media URL. Tied timestamps, concurrent inserts, and deletions do not break pagination.

## 4. Interactions and notifications

- [x] Implement idempotent likes/unlikes, bounded flat comments, comment deletion, and batched counts.
- [x] Implement in-app follow-request actions, grouped like notifications, comment notifications, unread state, and pagination.
- [x] Ensure notifications and source mutations cannot diverge silently; derive activity directly from current source tables, with atomic read acknowledgement.
- [x] Recheck visibility when rendering notifications and navigating to their targets; clean up or hide obsolete events.

Exit: three-user API flow covers following, posting, liking, commenting, accepting/denying requests, unread state, retries, and revoked access. Counts and grouped notifications remain correct after unlike/deletion.

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

## Completion evidence

For each stage, record commands/results in the work report, not as permanent design prose. Keep current docs concise. The final handoff includes the repository, local setup, deployment state, features completed, tests actually executed, observed cost assumptions, and specific unfinished prerequisites. A working local application and a verified deployed beta are different completion states.

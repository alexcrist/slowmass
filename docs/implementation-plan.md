# Implementation plan

Status: the core photo app, invitations, events, account deletion, storage quotas, and recovery tools are implemented. The feature READMEs describe current behavior; this plan tracks milestones and outstanding work. Deployment history belongs in Git and GitHub Actions, not this document. Browser and visual testing are prohibited. A local check is not hosted verification.

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
- [x] Implement invitation eligibility and permanent inviter attribution, through member invite links and event-link joining.
- [x] Give newly issued sign-in emails a four-hour lifetime and provide resend recovery for regular, invite, event, and installed-app flows; verify expiry, single use, and preserved invitation provenance against local Workers/D1.
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
- [x] Add prior-thread-participant and comment-like Activity, separate push/email choices (push on, email off), retry-safe sources and current-access delivery checks; bounded fan-out and migration compatibility have local Worker/API coverage.
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
- [x] Establish recurring backups: a nightly GitHub Actions job creates, verifies, and uploads encrypted archives to a write-only, seven-day S3 bucket (end-to-end local run and upload restrictions verified October 24, 2026; first scheduled run pending).
- [x] Add CI checks for format, lint, types, import boundaries, meaningful tests, migrations on a clean database, and production build. Pushes to `main` use the checked deployment workflow in [setup](setup.md#production-deployment).

Exit: real photos survive a documented restore in a nonproduction environment; deletion remains respected. No credentials or production data appear in test artifacts or logs.

## 6. Beta readiness and deployment

- [ ] Run full API flow with separate authenticated users; review UI semantics and responsive CSS statically. Never run browser or visual tests.
- [ ] Test direct unauthorized requests, stale media URLs, CSRF/origin checks, session expiry, duplicate publication, simultaneous likes, interrupted processing, and retryable cleanup.
- [ ] Seed realistic synthetic follow graphs and posts. Measure feed latency, D1 rows scanned, Worker CPU, and request counts; identify concrete upgrade thresholds from observed usage.
- [x] Configure production resources, secrets, verified email sender domain, and explicit deployment within the user's authorization. Apply each feature migration before dependent code.
- [ ] Verify the actual deployed login/upload/follow/feed/interaction flow. Do not equate a successful build or HTTP 200 with a working app.
- [x] Write the operations runbook with storage controls, retention, recovery quarantine, usage observations, and measured limitations.

Exit: an invited friend can sign in, post, follow another friend, and interact without developer assistance. No open privacy or data-integrity failures; any remaining limitations are explicit.

## 7. Events and member setup

- [x] Implement event creation with processed private covers, details, co-host invitations, guest answers, activity/messages, and bounded update blasts (Activity, push, and email, with a copy to the sending host).
- [x] Let members choose push and/or email per notification category in Settings → Notifications, with descriptive push and email text, category-specific one-click unsubscribe, like coalescing, an hourly per-notification alert cooldown, minute delivery, and daily notification email caps. Not yet measured: Worker CPU for a full push pass on the free plan, real-device display of descriptive alerts, and SES acceptance of the custom unsubscribe headers in production.
- [x] Replace email co-host invitations with in-app invitations to accepted followers/following with complete profiles, preserving consent and existing host roles.
- [x] Notify co-host invitations in Activity (inline Accept/Decline, push and email by default) and acceptances to the inviting host (push by default), with Settings categories for both; invitations after a decline arrive quietly.
- [x] Make event links invite new members with permanent inviter/link-version provenance; limit signed-out previews and gate the photo app on profile setup.
- [x] Implement curated event appearance, combined username/photo setup, calendar copies, cancellation, and creator-only deletion.
- [x] Allow event-only members to browse Find and other members’ profile previews; open account setup on Request to follow while retaining Feed/New post gates.
- [x] Include event media in backups and restore verification, and preserve upload identities across timeout/lost-response recovery.
- [x] Remove profile-photo audience guarantees and add title/cover-only event link previews; verify unlisted discovery and retained account access after opening a link through Workers/D1 tests.

Implemented behavior, permissions, and failure handling live in the [client events](../src/client/features/events/README.md), [server events](../src/server/features/events/README.md), and [calendar formatting](../src/shared/event-calendar/README.md) READMEs.

## Remaining operational verification

- [x] Provision the SES sender identity, DNS authentication, à-la-carte pricing, account suppression, and confirmed bounce/complaint alerts; verify both feedback paths with the SES mailbox simulator.
- [x] Switch sign-in email from Resend to [Amazon SES](setup.md#amazon-ses): production access granted, sender-scoped IAM credentials installed, the application-wide daily cap replaced by a $100/month AWS budget action, and a real signed request accepted by SES using the application's transport (mailbox simulator); a different From address is denied.
- [x] Observe a real production sign-in email delivered through SES and completed sign-in (October 24, 2026); the Resend API key secret is deleted from production.
- [ ] Optional event email requires separate consent, unsubscribe, authorization, and delivery work.
- [ ] Identify or rule out recurring signed-in startup stalls using affected-request diagnostics; measure the CPU cost of request-local authentication. The captured older timeout does not establish every reported failure's cause.
- [ ] Verify production session-cookie renewal after a day of use and diagnostic retention/expiry cleanup.
- [ ] Collect representative signed-in feed, profile, Activity, and image latency distributions, hosted cache hit rates, and storage/download measurements before choosing further performance work. Keep dated measurements in the operations runbook.
- [ ] Confirm device installation handoff and Web Push delivery: iPhone browser to Home Screen app to notifications, and Android notifications to installation. Confirm likes remain Activity-only while comments and event alerts reach opted-in devices.
- [ ] Observe event notification delays under real use. The existing five-delivery batch and 24-hour queue lifetime can delay or expire large push fan-outs; Activity persists independently.
- [ ] Confirm photo-upload recovery on affected devices and measure hosted processing latency; the exact causes of the reported upload incidents remain unverified.
- [x] Take and verify a fresh production backup that includes event media and copy it off-device (October 24, 2026: 94 photo variants verified and uploaded to S3).
- [ ] Complete the owner's event-flow review and confirm Google/Outlook saves and Apple calendar imports on real devices. Automated link/file tests do not exercise native app handoff; direct Outlook HTTP probes from the development environment return 417 even for its ordinary calendar page.

These device checks require owner observations; do not perform browser or visual testing. Routine deployment and CI results are available in [GitHub Actions](https://github.com/alexcrist/slowmass/actions/workflows/ci.yml).

## Google sign-in rollout

- [x] Configure production/development OAuth clients, credentials, verified domain, and existing app branding in Google Testing mode.
- [x] Implement backend account linking and consumer Gmail alias matching, preserving stored account IDs and invitation provenance; verify through synthetic Workers/D1 OAuth integration tests.
- [x] Audit production alias/provider collisions using aggregate read-only queries; no collisions found on October 21, 2026.
- [x] Draft the public privacy notice and implement the small homepage description/link locally; verify signed-out, script-free access through the Workers assets runtime.
- [x] Publish the public privacy page and homepage footer; complete Google's branding review and publishing requirements.
- [x] Repeat the audit and apply manual migration 0036 with the backup/maintenance runbook before backend rollout.
- [x] Implement Google sign-in controls for regular, invite-link, and event-link flows, with provider availability, pending/error recovery, and a synthetic local review page.
- [x] Complete owner visual review using [the review checklist](google-sign-in-review.md); approved email first, Google second. Release controls only after the migration gate.
- [x] Deploy Google controls/backend and verify public assets, private boundaries, provider availability, and authorization initiation by HTTP.
- [ ] Verify completed Google sign-in and magic-link account reuse with real accounts for normal, invite, and event flows. Local tests and authorization initiation are not complete live-provider verification.

# Implementation plan

Status: foundation in progress; external authentication and Cloudflare verification pending. Execute in dependency order. Check boxes represent observed completion, never generated code alone.

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
- [ ] Verify local static routing, API routing, D1 migrations, R2 access, and production bundling.
- [x] Verify email-link/D1 integration, session signatures, trusted origins, verified-email invitation checks, and logout in the local runtime with simulated email delivery.
- [ ] Verify real email delivery and secure sessions on the production HTTPS origin.
- [ ] Prove private image inspection/re-encoding via Images binding; verify output format, orientation, metadata removal, animation rejection, upload limits, and quota behavior.
- [ ] Measure deployed CPU for auth and a private-image request against the free Worker limit. Confirm the actual account supports the planned free services. If deployment prerequisites are unavailable, label local results accordingly and keep this gate open.
- [x] Add reproducible commands for local dev, migrations, checks, and build; document only commands that work.

Exit: one authenticated user can submit an image to a private test path and retrieve processed bytes; a stranger cannot. Record any change to the $0 target before building on a paid dependency.

## 2. Identity, profiles, and relationship privacy

- [ ] Implement onboarding, unique handles, private profile reads/edits, exact-handle lookup, and avatar processing.
- [x] Implement invitation eligibility and permanent inviter attribution, with an authenticated invitation form.
- [ ] Implement follow request/cancel/accept/deny, unfollow, follower removal, and block/unblock.
- [x] Enforce feature dependency boundaries and active-membership access.
- [ ] Establish private-profile/post access predicates.
- [ ] Add persistence constraints and integration tests for duplicate/crossing requests, ownership, concurrent transitions, and removed/blocked access.

Exit: two test users can establish and revoke a relationship; a third user cannot read private profile details or media. UI explains empty/requested/accepted states.

## 3. Publish and browse photos

- [ ] Implement bounded upload reservation, trusted processing, private variants, retry-safe publication, and orphan cleanup.
- [ ] Build compose preview/caption/alt-text flow with progress, cancellation, failures, and safe retry.
- [ ] Implement own profile posts, private post detail, and chronological home feed from accepted follows only.
- [ ] Add explicit cursor pagination, snapshot boundary, navigation history, viewport image loading, and caught-up state.
- [ ] Add post deletion with immediate access denial and durable retryable media cleanup.

Exit: upload on a narrow-screen browser, reload, and see exactly one published post. A follower sees it in order; pending/stranger/removed users cannot access it by API or saved media URL. Tied timestamps, concurrent inserts, and deletions do not break pagination.

## 4. Interactions and notifications

- [ ] Implement idempotent likes/unlikes, bounded flat comments, comment deletion, and batched counts.
- [ ] Implement in-app follow-request actions, grouped like notifications, comment notifications, unread state, and pagination.
- [ ] Ensure notifications and source mutations cannot diverge silently; use atomic writes or a minimal durable outbox when required.
- [ ] Recheck visibility when rendering notifications and navigating to their targets; clean up or hide obsolete events.

Exit: three-user browser flow covers following, posting, liking, commenting, accepting/denying requests, unread state, retries, and revoked access. Counts and grouped notifications remain correct after unlike/deletion.

## 5. Complete mobile experience and operations

- [ ] Establish visual design with the frontend-design skill before styling implementation. Use a photo-first mobile layout and accessible navigation, focus, labels, and touch targets.
- [ ] Cover loading, empty, permission-denied, offline/network-error, quota, and unsupported-photo states. Installable web app is optional; never cache private photos for offline use.
- [ ] Implement account deletion and recovery-aware cleanup, per-user upload limits, mutation rate limits, and operator invitation/block controls through a simple script or existing interface.
- [ ] Add privacy-preserving metrics, bounded logs, cost monitoring instructions, backup/export procedure, and a restore exercise.
- [ ] Add CI checks for format, lint, types, import boundaries, meaningful tests, migrations on a clean database, and production build. Keep production deploy explicit initially.

Exit: real photos survive a documented restore in a nonproduction environment; deletion remains respected. No credentials or production data appear in test artifacts or logs.

## 6. Beta readiness and deployment

- [ ] Run full browser flow with separate authenticated users on phone and desktop viewports, plus keyboard/accessibility checks.
- [ ] Test direct unauthorized requests, stale media URLs, CSRF/origin checks, session expiry, duplicate publication, simultaneous likes, interrupted processing, and retryable cleanup.
- [ ] Seed realistic synthetic follow graphs and posts. Measure feed latency, D1 rows scanned, Worker CPU, and request counts; identify concrete upgrade thresholds from observed usage.
- [ ] Configure production resources, secrets, email sender domain, migration order, and explicit deployment only within the user's deployment authorization. State any external prerequisites precisely.
- [ ] Verify the actual deployed login/upload/follow/feed/interaction flow. Do not equate a successful build or HTTP 200 with a working app.
- [ ] Write a concise operator runbook and update documentation to reflect actual implementation and measured limitations.

Exit: an invited friend can sign in, post, follow another friend, and interact without developer assistance. No open privacy or data-integrity failures; any remaining limitations are explicit.

## Completion evidence

For each stage, record commands/results in the work report, not as permanent design prose. Keep current docs concise. The final handoff includes the repository, local setup, deployment state, features completed, tests actually executed, observed cost assumptions, and specific unfinished prerequisites. A working local application and a verified deployed beta are different completion states.

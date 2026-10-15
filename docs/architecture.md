# Architecture and operating model

Status: proposed design. Provider documentation reviewed October 10, 2026; account-level behavior and selected dependency versions must be verified during the first implementation stage.

## Purpose

Give people control over their attention and private social connections. The product serves relationships rather than engagement metrics: chronological feeds of own posts and accepted follows, finite pages, explicit consent to follow, no advertising or behavioral tracking. Cost decisions should preserve that purpose.

## Initial stack

One TypeScript application: React/Vite mobile-first client, Hono API on Cloudflare Workers, D1 relational database, private R2 object storage. Serve static assets and API from the same origin. Use Better Auth with one-time email links and D1, validating the supported adapter and migration workflow in a spike. Choose pinned supported versions during implementation, not from memory. Use a single package initially rather than a monorepo toolchain.

Proposed source layout: `src/client/features/`, `src/server/features/`, `src/shared/` for cross-boundary schemas only, and feature-independent infrastructure alongside server features. Migrations live in `migrations/`. Keep domain SQL in feature-owned stores; do not add a generic persistence framework. Auth library tables have one clearly owned migration stream integrated with application migrations.

Build the frontend as static assets; private feeds have no SEO need and do not require per-request server rendering. No Redis, realtime service, dedicated queue, analytics vendor, or always-on VM at launch. Use local Workers/D1/R2 emulation for development and a separate disposable test environment when remote verification is required.

## Core data and concurrency

Concepts: user/profile, session/account (auth library), membership with immutable inviter attribution, invitation, follow request/accepted relationship, block, media upload, post, like, comment, notification, and cleanup task. Database uniqueness enforces one relationship and one like per pair; foreign keys and explicit lifecycle rules prevent dangling accessible content.

Use validated client UUIDs for retryable posts/comments and server timestamps. Make publish, follow transitions, and notification creation retry-safe with scoped idempotency keys or natural unique constraints. Use D1-supported atomic batches/conditional SQL, not assumptions about interactive transactions. Check permissions in the mutation's SQL/atomic operation where a preceding check could race with removal or blocking.

Notifications use an indexed directory of interaction sources maintained by database triggers in the same transaction as the source mutation. This was introduced after a local 3,000-post benchmark showed lifetime aggregation reading 216,000 rows to display and acknowledge 20 events. The indexed version read 320 rows for that workload in the October 11 benchmark, before acknowledgement tracking was removed. Reads still evaluate current membership, blocks, publication state, and visible like-group ordering; the index grants no access. Activity remains one chronological list. Migration 0018 adds per-source read receipts with monotonically increasing versions and an index of unread sources. Page reads are read-only; a separate authenticated acknowledgement validates the displayed version and clears only visible sources through that version. Badge reads seek unread sources rather than scanning read history. Legacy read markers are imported once, and source deletion cascades to receipts. Logical event keys and versions are shared by the list, badge, and acknowledgements, and identify Web Push deliveries. Migration 0019 adds an opt-in subscription and transactional delivery queue using the same identities. A bounded dispatcher runs after interactions and on an hourly cron in the existing Worker, with leases and bounded retries. Delayed like groups and failed immediate deliveries wait for another dispatch opportunity; an idle backlog drains at most five deliveries per hour. Generic encrypted payloads avoid lock-screen disclosure, and current authorization is checked before sending and on opening Activity. Migration 0020 adds follower events after acceptance or invitation photo completion, atomically preserving existing receipt versions and pending deliveries without backfilling old accepted follows. Follower visibility additionally requires the live accepted relationship and completed profiles. No new hosted service is introduced. See the notifications and push READMEs for tradeoffs and limits.

## Authorization and sessions

Same-origin secure HTTP-only cookies; use the auth library for single-use email verification, hashed link tokens, CSRF defenses, session expiration, and logout. Validate trusted origins and invitation eligibility at the backend, including email verification/account creation. Never treat an unverified email or client-supplied user ID as identity. Do not fetch avatars from third-party identity services.

A viewer can access a post only as its owner or through a current accepted follow, subject to blocks and deletion. Reuse this predicate for feeds, detail views, media, likes, comments, and notifications. Notification ownership alone never grants access to its target.

Profile usernames, names, and avatars are visible to active signed-in members unless either member blocked the other. Bios, posts, and Following/Followers lists require ownership or an accepted follow. Relationship pages recheck access and filter accounts blocked in either direction with the viewer before pagination; requests and blocked-account lists remain owner-only. Avatar media remains in private R2 and every request checks membership and blocks.

Private media is served through an authenticated Worker route with a resource ID and allowlisted variant. R2 public access stays disabled. Every request rechecks authorization, including conditional requests. Browser responses use `Cache-Control: private, no-store`; private content is never cached by a service worker. The implemented [private delivery module](../src/server/photos/README.md#private-delivery) reuses immutable processed bytes in a named Workers cache only after fresh authorization selects the current object key. Internal entries expire after one hour; access revocation and avatar replacement do not depend on expiry or global purge. No public cache route or cached authorization decision is introduced. Signed-link delivery remains a future tradeoff.

Membership retains a permanent parent pointer to the inviter and the accepted invitation. D1 triggers atomically consume invitations and reject changes to provenance. Issuance and acceptance require an active inviter. The single bootstrap root is protected by a unique index. Preserve minimal tombstones through account deletion; do not build mass-ban tools yet.

Invitation email links are seven-day, join-only credentials. Their confirmation page does not accept on load, avoiding consumption by email prefetchers. A Better Auth plugin uses a same-origin POST and the conditional membership insert to accept exactly once, then uses the library's identity/session APIs. An indexed credential hash is separate from the invitation ID exposed to the inviter. Retry email payloads are encrypted with the library until delivery is confirmed. Joining through any path disables invitation credentials for that email; returning-member login links remain valid for ten minutes. This reuses the existing Worker, D1, and Resend setup.

An initial-profile trigger creates mutual accepted follows between inviter and invitee once both profiles exist. It checks active membership and blocks in the same transaction. It does not run on profile edits or sign-in, and does not backfill completed profiles, so historical unfollows remain respected.

Email delivery uses Resend with explicit application-wide and per-recipient budgets, without tracking pixels or link tracking. Better Auth stores one-time tokens hashed and rate-limits requests through D1. Real hosted delivery is an external setup gate.

## Photo lifecycle

Client resizing improves upload speed but is not validation. Accept bounded uploads from authenticated eligible users, enforce per-user quotas, and reject oversized bodies while streaming. Restrict input formats to still formats verified by the processor; reject animation and SVG. Handle phone orientation and unsupported HEIC explicitly.

Use the Cloudflare Images binding to inspect/decode/re-encode private bytes and generate bounded WebP variants per post (1600px full and 480px grid, reusing the processed full image for small posts) or avatar (320px small and 1600px large, sharing the object for small inputs) at upload, storing the result in R2. Set pixel limits, output dimensions/quality, and metadata stripping explicitly. Retain no original after successful processing. Never resize on each view. Verify binding availability, remote test support, format detection, metadata removal, CPU usage, and free-tier accounting before committing to this path.

Lifecycle: reserve an upload record and idempotency key, process into private temporary/final objects, then atomically publish the post only after required variants exist. Publication retries return the same post. Processing errors expose no post or original and can be retried. A scheduled bounded cleanup pass removes expired uploads and retries deletion tasks. D1 and R2 cannot commit together, so write durable intent and reconcile orphan objects; do not imply distributed transactions exist.

If the image binding cannot meet the free-tier/runtime requirements, stop that implementation stage and document a concrete alternative and its cost. Do not silently replace trusted processing with client-only checks or publish raw originals.

## Feed and pagination

Query the viewer’s own published posts and current accepted follows in descending `(published_at, id)` order. Include the viewer directly in the eligible author set without creating a self-follow; each author contributes the same bounded number of candidates. Use a validated cursor with a bounded page size and an upper snapshot boundary so newer inserts do not shift an ongoing pagination session. Preserve cursor history for Newer/Older navigation; a refresh starts a new snapshot. Current access and deletion always override the snapshot.

Index actual query patterns and inspect query plans/rows scanned. Batch aggregate like/comment counts and viewer-like state per page. Avoid one query per card. Comments and notifications also have bounded cursor pagination. Do not precompute timelines until measurements justify the additional writes and revocation work.

Member discovery uses a persisted random key with an index. A per-browse random starting point wraps around that index, giving stable shuffled keyset pages without sorting the entire directory randomly per request. Search applies a literal, case-insensitive ordered-subsequence match to usernames and names. It allows missing letters, not arbitrary spelling corrections. Queries have a three-character minimum, 350 ms client debounce, and a server limit of 30 requests/member/minute. Filtered searches can still scan many profiles; monitor D1 rows read and introduce a dedicated search index if actual size/usage requires it. No hosted search service is added.

## Operating cost and recovery

Target $0 recurring provider charges within allowances; domain registration is separate. R2 may require billing setup even when usage is free. Free quotas are ceilings, not uptime guarantees. Monitor usage near 50%, 75%, and 90% of relevant allowances; enforce application upload limits before exhausting processing capacity. Budget alerts are not guaranteed hard caps.

Current planning allowances:

- Workers: free static requests; 100,000 dynamic requests/day, 10 ms CPU/invocation. Photos and auth routes consume dynamic requests too.
- D1: 5 million rows read and 100,000 rows written/day; 500 MB per free database, 5 GB account-wide. Index writes count toward usage. Free recovery window: seven days.
- R2 Standard: 10 GB-month, one million Class A and ten million Class B operations/month included; no egress fee. Storage continues to accrue while the app is idle.
- Images: 5,000 unique transformations/month on Free, then new transformations fail. Two variants roughly halve the upload allowance; avatars and retries must be accounted for. Persist variants to avoid repeated monthly transformations.

Instrument aggregate request/CPU/error metrics, database scans/writes, upload failures, object bytes, and transformations. Do not collect behavioral profiles. Keep persistent request logs disabled initially and redact user content from application errors. Baseline the actual beta workload rather than predicting capacity from user count alone.

The operations tooling now verifies encrypted exports and synthetic photo restoration; a disposable hosted database has passed a Time Travel drill. Follow the operations runbook for manual backup cadence and off-device copies. Keep backup artifacts access-restricted. R2 durability is not backup protection against accidental deletion; define a separate encrypted backup copy and bounded retention for published photos, account for its bytes, and test restoration. Recovery must preserve deletion records so restoring a backup does not resurrect access to deleted content. Document the recovery window and data-loss tolerance.

## Growth path

Production fetch handlers use a Washington-region placement hint to reduce round trips to the D1 primary observed in Seattle. Cloudflare chooses the nearby execution location; this is not an exact-city guarantee and does not provision Azure resources. Static assets retain edge delivery, and this setting does not relocate D1/R2 or scheduled handlers. See the dated measurements in the operations runbook before attributing improvements to placement.

1. Near free limits: upgrade Workers/D1 together as needed (Workers Paid starts at $5/month plus usage), and enable paid Images only when required. No application rewrite.
2. Excess scans or latency: fix indexes, queries, page sizes, and repeated reads before adding services. Add a durable queue for processing/cleanup only if synchronous latency or backlog warrants it.
3. Media delivery pressure: cache immutable bytes behind per-request authorization, use bounded authorization batching, and measure revocation correctness. Do not make private photos public for CDN convenience.
4. Database pressure: paid D1 caps each database at 10 GB and has single-database throughput constraints. Monitor size, contention, and latency well before those limits. Migrate the relational store to managed Postgres when needed; keep stable domain IDs, private R2 keys, and API contracts. This is an explicit migration with schema translation, validation, controlled write cutover, and rollback, not an automatic upgrade or cost-free ORM switch. Prefer a short controlled maintenance window to speculative dual writes.
5. Feed query pressure from large follow graphs: consider indexed timeline materialization or hybrid fan-out, preserving authoritative access checks. Implement only after load measurements identify the bottleneck.

## Sources

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Images pricing](https://developers.cloudflare.com/images/pricing/) and [private byte processing binding](https://developers.cloudflare.com/images/optimization/binding/)
- [Better Auth database support](https://better-auth.com/docs/adapters/other-relational-databases)

## Current shared invitation model

Admission, email authentication, and private-post access use the existing Worker, D1, Better Auth magic-link delivery, and membership graph. Migration 0025 stores one rotating credential per inviter with fixed seven-day expiry and no sign-up cap. Conditional writes converge concurrent copies and compare versions on replacement. Short-lived claims pin the chosen inviter and exact credential hash/version across browsers; membership checks them inside the atomic invitation/membership batch. Shared invitations grant no automatic follows. Each successful join retains immutable invitation type, inviter, and timestamps independently of the rotating credential. Join Activity waits for required photo completion and uses existing indexed sources, read receipts, and opt-in push.

The current model is deployed with migration 0025; see the dated release record in setup.md. It replaces the original multi-link/capacity model from migrations 0022–0024. Migration 0025 requires unused shared-link state, preserves personal invitations and existing membership, and removes the old history/capacity schema. See the invitations README and operations runbook for failure and rollout behavior.

## Optional device setup

Migration 0027 introduces account-level pending setup for future members only and allows multiple browser push endpoints to belong to one authenticated session. This models iOS cookie copying at installation without confusing session identity with isolated browser storage. Consent stays per endpoint; logout revokes every endpoint owned by that session. Migration preserves queued work and requires a maintenance window with the matching Worker. Bootstrap includes one additional indexed pending-state read, concurrent with the profile read. There is no new service, polling loop, device fingerprint, or client credential storage. See the device-setup and push feature READMEs for implemented behavior.

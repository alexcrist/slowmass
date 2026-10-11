# Slowmass

A mobile-first photo app for friends. The home feed contains only posts from accepted follows, newest first, with explicit pagination. One still image per post. Every profile is private. No recommendations, ads, videos, albums, stories, reels, or infinite scroll. Login uses verified one-time email links only. Every member after the bootstrap root must be invited by an active member; preserve the invitation tree permanently.

Initial operating target: $0/month within free allowances, with a measured path to paid capacity. Minimize both hosting cost and maintenance. Do not trade away authorization, data integrity, or recovery to save pennies.

## Read first

- [README.md](README.md): repository status and entry points.
- [docs/product.md](docs/product.md): intended product behavior and scope.
- [docs/architecture.md](docs/architecture.md): proposed architecture, privacy, cost model, and scaling decisions.
- [docs/implementation-plan.md](docs/implementation-plan.md): executable build stages and acceptance criteria.

The repository contains email-link authentication, member invitations, profiles, private avatars, follow relationships, photo posts, a paginated feed, likes, comments, and in-app notifications. Account deletion, storage limits, and recovery tools are implemented; operational rollout status and limitations are tracked in the plan. Keep proposed behavior visibly separate from verified implementation. As features ship, their local READMEs become the authority for implemented behavior.

- [docs/design.md](docs/design.md): visual direction.
- [docs/setup.md](docs/setup.md): external setup and migration workflow.
- [docs/operations.md](docs/operations.md): storage limits, backup/restore, retention, and usage inspection.

## Software design

- **KISS and YAGNI.** Use the simplest design that satisfies an observed requirement. No speculative services, frameworks, extension points, or generic repositories.
- **SOLID in practice.** Give modules cohesive responsibilities, depend on small explicit contracts at external boundaries, and prefer composition. Do not manufacture a class hierarchy to satisfy a slogan.
- **One name per concept.** Keep domain names consistent across UI code, API, persistence, tests, and docs.
- **Feature-based organization.** Put each feature's implementation, tests, and README together. Features spanning client and server use matching names. Keep migrations centralized.
- **Code that changes together lives together.** Extract a shared module when a second real consumer needs it. Avoid global utility dumping grounds.
- **Dependencies form a directed acyclic graph.** Features use another feature only through its public domain API. Shared infrastructure never imports feature code. Composition roots wire modules together and contain no business rules. Enforce import boundaries mechanically once code exists.
- **Keep infrastructure at boundaries.** Route handlers parse and authenticate; domain functions enforce rules; feature-owned persistence functions use explicit queries. Isolate D1 and R2 access without pretending every database has identical semantics.
- **Backend authority.** Permissions, publication states, quotas, timestamps, and valid transitions are enforced server-side. Frontend checks are UX, never security.
- **TypeScript strict mode.** Validate untrusted input at runtime, model states explicitly, and avoid unchecked casts and `any`. Use parameterized SQL and database constraints for invariants.
- **Design for retries.** Mutations that may be retried must not duplicate posts, likes, relationships, or notifications. Specify atomicity, concurrency, and recovery behavior.
- **Simple bounded work.** Every list has a maximum page size; every upload has byte and pixel limits. Avoid per-item queries and unbounded scans.
- **No speculative compatibility.** Remove superseded code during development. Once real users have data, use explicit migrations and backward-compatible deployment sequencing where required to preserve it.

## Privacy and security

- Authorize every private resource, including image bytes, thumbnails, avatars, comments, and notifications. An opaque ID is not authorization.
- An accepted follow grants access to posts and bios; a pending request does not. Username, profile name, and avatar are visible to active, signed-in, unblocked members. Removal, blocking, deletion, and logout must have tested access semantics.
- Never introduce public object URLs or a cache path that bypasses authorization. Do not cache private API responses or photos in a service worker.
- Use a maintained authentication library. Never invent OAuth, token signing, password hashing, or session cryptography. Keep development authentication physically excluded from production configuration.
- Use secure HTTP-only session cookies, explicit trusted origins, library-supported CSRF protection, and server-side ownership checks. Keep secrets out of source, logs, client bundles, and fixtures.
- Decode and re-encode accepted images through a trusted server-side processor. Validate format, size, and dimensions; strip metadata. Never fall back to exposing an unvalidated original.
- Log operational context with request IDs, not photo bytes, captions, comments, tokens, or signed URLs. Return safe client errors and retain diagnostic detail server-side.

## Documentation

Read relevant docs before changing code; update changed contracts in the same change. Document purpose, tradeoffs, invariants, failure behavior, and useful troubleshooting. Do not duplicate schemas, signatures, route inventories, configuration values, or code narration.

Each feature/shared module gets a proportionate README, even if only a few sentences. Package READMEs map features and dependency order. Cross-cutting decisions live in `docs/` and are indexed above. Use repository docs instead of agent auto-memory. Plans describe intended work; implemented docs describe verified current behavior. Keep historical measurements in explicitly dated records.

## Implementation workflow

1. Read the product contract and the next build stage. Inspect existing code and dependencies before choosing tools.
2. Implement a complete, small vertical slice. Match established conventions; refactor inconsistent approaches rather than accumulating competing patterns.
3. Verify behavior with the cheapest meaningful check. Test permissions, concurrency, pagination, failure recovery, and integration at their actual boundaries.
4. Review the diff for bugs, unnecessary abstraction, dead code, sensitive data, and cost amplification. Fix discovered issues relevant to the change.
5. Update docs and plan checkboxes honestly. Report implemented behavior, checks actually run, and remaining limitations.

AI-assisted work is held to the same bar as any other code. Fast generation is not evidence of correctness. Never claim a command, deployment, test, or restore succeeded without observing its result. Prefer direct CLI/API tools. Never perform browser testing or visual testing. Follow existing user authorization and do not insert unnecessary approval gates.

## Testing and UI quality

Use the approved early photo-app direction in `docs/design.md`: a lowercase slowmass script wordmark, Douglas Fir green header, white photo frames, and understated off-white surfaces. Pair locally hosted Caveat with Source Sans 3. Keep copy functional, with clear labels and status messages; no slogans, marketing copy, decorative illustrations, or invented activity.

- Add focused unit tests for domain rules and meaningful integration tests against the Workers/D1 runtime. Mock external providers only at their boundaries.
- **Never perform browser testing or visual testing.** Do not launch browser automation, capture or inspect screenshots, or run visual regression checks. The user explicitly prohibits these because of time and token cost. Verify behavior with static analysis, type checks, unit/integration tests, database checks, and direct HTTP/API requests instead.
- Include negative cases: pending follower, stranger, blocked user, removed follower, expired session, duplicate mutation, interrupted upload, and deleted content.
- Keep fixtures synthetic. CI must not use production accounts, production data, or a production database.
- Use formatting, linting, type checking, boundary checks, tests, and a production build as commit/CI gates once tooling exists. Do not invent commands in documentation before implementing them.
- Preserve mobile usability, semantic HTML, keyboard navigation, focus, touch targets, image alt text, and loading/empty/error states. Use the frontend-design skill when available before implementing visual design.

## Operations and cost

Start with one deployable application, one D1 database, and private R2 storage. Add infrastructure only for measured needs. Measure request/CPU usage, rows scanned/written, stored bytes, and transformations; free-tier ceilings are not availability guarantees or hard spending caps.

Prefer local development and CI emulation over idle hosted staging resources. Migrations run explicitly, never opportunistically during requests. Separate preview and production data. Maintain a tested restore procedure and deletion cleanup. Do not silently provision paid services or enable automatic production deployment as an incidental code change.

`CLAUDE.md` is the canonical agent instruction file. `AGENTS.md` must be a relative symlink to `CLAUDE.md`, not a second copy.

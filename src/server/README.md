# Server

Hono runs on Cloudflare Workers. The composition root owns request IDs, privacy headers, mutation origin checks, route registration, and scheduled cleanup. Shared modules are [membership](membership/README.md), [email](email/README.md), [auth](auth/README.md), [photos](photos/README.md), and [request telemetry](telemetry/README.md).

[Account](features/account/README.md) and [invitations](features/invitations/README.md) depend on auth; account bootstrap also uses the people profile read; invitations also uses membership, the people onboarding check, and shared email transport. [People](features/people/README.md) owns profiles and relationships. [Avatars](features/avatars/README.md) uses people visibility and trusted photo processing. [Posts](features/posts/README.md) owns publication, feed, and cleanup. [Interactions](features/interactions/README.md) owns likes/comments; [notifications](features/notifications/README.md) derives current activity. [Push](features/push/README.md) depends on notifications for current visibility and manages optional session-bound subscriptions and delivery. Member feature routes require a saved profile photo through the people domain check. Auth, own-profile setup, avatar upload, and account deletion remain available during onboarding. Dependencies remain acyclic.

Unknown API routes return JSON errors. Private avatar and post delivery check authorization before R2 access; unknown media routes fail closed. `env.ts` is the binding contract. The default Wrangler environment is local; `production` explicitly selects the live resources and HTTPS origin.

Integration tests bundle the entry point into Miniflare and run real D1-backed sessions, profiles, relationships, and R2 authorization. Email is simulated or blocked at the outbound boundary. No browser or visual tests are run.

Feature `index.ts` files define public entry points; cross-feature consumers use those exports. Boundary tests resolve imports through the TypeScript configuration and check static imports, re-exports, dynamic imports, CommonJS imports, and type imports. Computed module loading is rejected. Dependency cycles and client/server crossings fail the check. On the server, the composition root may mount public router adapters, while routers and the root may not issue database queries.

[Startup diagnostics](diagnostics/README.md) retain bounded anonymous failure evidence in D1, independently of authentication. Telemetry supplies server snapshots; the composition root wires the write-only endpoint and retention cleanup.

[Device setup](features/device-setup/README.md) retains legacy optional onboarding progress for previously loaded clients; the current client ignores it and ends onboarding after photo setup. Account bootstrap composes its public read with the people profile read; neither install nor push consent gates member access. Push owns independent browser endpoints within authenticated sessions.

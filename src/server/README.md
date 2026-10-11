# Server

Hono runs on Cloudflare Workers. The composition root owns request IDs, privacy headers, mutation origin checks, route registration, and scheduled cleanup. Shared modules are [membership](membership/README.md), [email](email/README.md), [auth](auth/README.md), and [photos](photos/README.md).

[Account](features/account/README.md) and [invitations](features/invitations/README.md) depend on auth; invitations also uses membership. [People](features/people/README.md) owns profiles and relationships. [Avatars](features/avatars/README.md) uses people visibility and trusted photo processing. Dependencies remain acyclic.

Unknown API routes return JSON errors. Private avatar delivery checks authorization before R2 access; all other media routes fail closed. `env.ts` is the binding contract. The default Wrangler environment is local; `production` explicitly selects the live resources and HTTPS origin.

Integration tests bundle the entry point into Miniflare and run real D1-backed sessions, profiles, relationships, and R2 authorization. Email is simulated or blocked at the outbound boundary. No browser or visual tests are run.

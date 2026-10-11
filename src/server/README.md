# Server

Hono runs on Cloudflare Workers. The composition root owns request IDs, response privacy headers, mutation origin checks, and route registration. Shared modules are [membership](membership/README.md), [email](email/README.md), and [auth](auth/README.md); auth depends on membership and email. The independent features [account](features/account/README.md) and [invitations](features/invitations/README.md) both depend on auth; invitations also uses membership. Neither feature imports the other.

Unknown API routes return JSON errors. All media requests fail closed until authorized media delivery is implemented. `env.ts` is the binding contract. The checked-in Wrangler configuration is local-only until real resource IDs and production settings are installed.

Integration tests in `tests/worker.test.ts` bundle this entry point into Miniflare and run real D1-backed sessions. The tests simulate outbound email and do not call hosted email or Cloudflare services.

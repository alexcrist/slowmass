# Authentication

Better Auth owns one-time email links and signed cookie sessions; D1 stores its schema and request-rate counters. No passwords or social login providers are enabled. Links expire after ten minutes, are stored hashed, and can be consumed once. Verification creates an email-verified identity before session issuance.

[Membership](../membership/README.md) is required during user/session creation and on private API reads/writes. Verification also checks that an invitation's issuer remains active. A narrowly configured first-member bootstrap establishes the root of the invitation tree.

Missing credentials fail closed. Session cookie caching is disabled so invalidation reaches D1. Development uses localhost cookies; production requires secure cookies and a separate auth secret. Mutation origin checks supplement library protections. Production uses Cloudflare's client-IP header for request throttling.

`options.ts` owns library configuration and lifecycle hooks; `index.ts` creates the library instance. Worker integration tests exercise actual email-link issuance and verification through a simulated outbound email transport. They do not send real email or prove hosted deliverability.
